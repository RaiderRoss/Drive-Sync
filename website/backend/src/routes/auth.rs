//! # Authentication and Authorization
//!
//! This module provides user registration, authentication, JSON Web Token
//! (JWT) generation and verification, and Axum middleware for protecting
//! authenticated and administrator-only routes.
//!
//! Passwords are hashed using Argon2 before being stored. Successful
//! authentication produces a JWT containing the user's ID, administrator
//! status, and expiration timestamp.
//!
//! Authentication information is also made available to request handlers
//! through Axum request extensions.

use crate::{
    AppState,
    EventScope::Admin,
    ServerEvent,
    util::{
        util::{self, log_actions},
        db::{create_user, get_user_by_username},
    },
};

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};

use axum_extra::extract::cookie::{Cookie, SameSite};

use rand::rngs::OsRng;

use axum::{
    Json,
    body::Body,
    extract::State,
    http::{Request, StatusCode, header::SET_COOKIE},
    middleware::Next,
    response::{IntoResponse, Response},
};

use chrono::{Duration, Utc};

use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};

use serde::{Deserialize, Serialize};

use serde_json::{Value, json};

/// JWT authentication claims.
///
/// This structure is serialized into and deserialized from the JWT payload.
/// It identifies the authenticated user, records whether the user has
/// administrator privileges, and stores the token expiration timestamp.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Data {
    /// The unique identifier of the authenticated user.
    pub user: String,

    /// Indicates whether the authenticated user has administrator privileges.
    pub admin: bool,

    /// The JWT expiration time as a Unix timestamp.
    pub exp: usize,
}

/// Wrapper containing the authenticated user's JWT claims.
///
/// This type is inserted into Axum request extensions by the authentication
/// middleware and can subsequently be extracted by route handlers.
#[derive(Clone)]
pub struct AuthUser(pub Data);

/// Registers a new user account.
///
/// The username and password are read from the JSON request body. The
/// password is hashed using Argon2 with a randomly generated salt before the
/// user is stored in the database.
///
/// Newly registered users are not administrators. After successful
/// registration, a JWT is generated and returned to the client. A
/// user-registration event is also broadcast to connected administrators.
///
/// An HTTP-only cookie containing the JWT is also created for the SSE
/// endpoint.
///
/// # Arguments
///
/// * `State(state)` - Application state containing the database connection
///   and server event broadcaster.
/// * `Json(user_data)` - JSON object containing the `username` and `password`
///   fields.
///
/// # Request Body
///
/// The request body is expected to contain:
///
/// ```json
/// {
///     "username": "example",
///     "password": "password"
/// }
/// ```
///
/// # Returns
///
/// Returns `200 OK` containing a JSON object with the generated JWT.
///
/// Returns `409 Conflict` when the username already exists.
///
/// Returns `500 Internal Server Error` when the user cannot be created.
///
/// # Side Effects
///
/// A registration action is written to the action log and an administrator
/// `registered` event is broadcast.
pub async fn register_user(
    State(state): State<AppState>,
    Json(user_data): Json<Value>,
) -> impl IntoResponse {

    let username = user_data.get("username").unwrap().as_str().unwrap();

    let password = user_data.get("password").unwrap().as_str().unwrap();

    let salt = SaltString::generate(&mut OsRng);

    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .expect("Failed to hash password")
        .to_string();

    let user = create_user(&state.db, username, &hash, false).await;

    if let Err(e) = user {
        if let sqlx::Error::RowNotFound = e {
            return (StatusCode::CONFLICT, "Username already exists").into_response();
        }

        return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create user").into_response();
    }

    let user = user.unwrap();

    let token = generate_jwt(user.clone(), false);

    log_actions(
        format!("{}:{}", username, user),
        "register".to_string(),
        "".to_string(),
    );

    let _ = state.events.send(ServerEvent {
        scope: Admin,
        event_type: "registered".to_string(),
        data: json!({
            "action": "create",
            "user_id": user,
            "username": username,
            "is_admin": false
        }).into(),
    });

    let cookie = Cookie::build(("sse_token", token.clone()))
        .http_only(true)
        .same_site(SameSite::Lax)
        .path("/api/events")
        .secure(false)
        .build();

    (
        StatusCode::OK,
        [(SET_COOKIE, cookie.to_string())],
        Json(json!({ "token": token })),
    )
        .into_response()
}

/// Authenticates an existing user.
///
/// The username and password are read from the JSON request body and
/// compared against the stored Argon2 password hash.
///
/// On successful authentication, a JWT containing the user's ID,
/// administrator status, and expiration time is generated. The token is
/// returned to the client and also stored in an HTTP-only cookie used by
/// the SSE endpoint.
///
/// # Arguments
///
/// * `State(state)` - Application state containing the database connection.
/// * `Json(user_data)` - JSON object containing the `username` and `password`
///   fields.
///
/// # Request Body
///
/// The request body is expected to contain:
///
/// ```json
/// {
///     "username": "example",
///     "password": "password"
/// }
/// ```
///
/// # Returns
///
/// Returns `200 OK` with a JSON object containing the generated JWT when
/// authentication succeeds.
///
/// Returns `401 Unauthorized` when the username does not exist or the
/// password is incorrect.
///
/// Returns `500 Internal Server Error` when the user cannot be retrieved
/// from the database.
pub async fn login(
    State(state): State<AppState>,
    Json(user_data): Json<Value>,
) -> impl IntoResponse {

    let username = user_data.get("username").unwrap().as_str().unwrap();

    let password = user_data.get("password").unwrap().as_str().unwrap();

    let user = get_user_by_username(&state.db, username).await;

    if let Err(e) = user {
        if let sqlx::Error::RowNotFound = e {
            return (StatusCode::UNAUTHORIZED, "Invalid username or password").into_response();
        }

        return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to retrieve user").into_response();
    }

    let (user_id, hash, is_admin) = user.unwrap();

    let parsed = PasswordHash::new(&hash).expect("Failed to parse password hash");

    if Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
    {
        let token = generate_jwt(user_id.clone(), is_admin);

        log_actions(user_id, "login".to_string(), "".to_string());

        let cookie = Cookie::build(("sse_token", token.clone()))
            .http_only(true)
            .same_site(SameSite::Lax)
            .path("/api/events")
            .secure(false)
            .build();

        (
            StatusCode::OK,
            [(SET_COOKIE, cookie.to_string())],
            Json(json!({ "token": token })),
        )
            .into_response()
    } else {
        (StatusCode::UNAUTHORIZED, "Invalid username or password").into_response()
    }
}

/// Generates a signed JSON Web Token for a user.
///
/// The token contains the user's ID, administrator status, and expiration
/// timestamp. The expiration duration is read from the application's JWT
/// configuration.
///
/// The token is signed using the configured JWT secret and the default
/// JSON Web Token header configuration.
///
/// # Arguments
///
/// * `user_id` - Unique identifier of the user for whom the token is being
///   generated.
/// * `admin` - Indicates whether the user has administrator privileges.
///
/// # Returns
///
/// Returns the encoded JWT as a [`String`].
///
/// # Panics
///
/// Panics if `JWT_SECRET` or `JWT_DURATION_MINUTES` has not been initialized,
/// or if JWT encoding fails.
pub fn generate_jwt(user_id: String, admin: bool) -> String {
    let jwt_secret = util::JWT_SECRET.get().expect("JWT_SECRET not set");

    let jwt_duration_minutes = util::JWT_DURATION_MINUTES
        .get()
        .expect("JWT_DURATION_MINUTES not set");

    let expiry = Utc::now() + Duration::minutes(*jwt_duration_minutes);

    let exp_timestamp = expiry.timestamp() as usize;

    let claims = Data {
        user: user_id,
        admin,
        exp: exp_timestamp,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )
    .expect("Token encoding failed")
}

/// Verifies a JWT and converts it into authenticated user information.
///
/// The token is decoded using the configured JWT secret and validated using
/// the HS256 signing algorithm. The JWT's expiration time is also validated
/// by the JSON Web Token validation configuration.
///
/// # Arguments
///
/// * `token` - JWT string supplied by the client.
///
/// # Returns
///
/// Returns [`AuthUser`] containing the decoded claims when the token is valid.
///
/// # Errors
///
/// Returns [`StatusCode::UNAUTHORIZED`] with an error message when the token
/// is invalid or expired.
///
/// # Panics
///
/// Panics if `JWT_SECRET` has not been initialized.
pub fn verify_token(token: &str) -> Result<AuthUser, (StatusCode, &'static str)> {
    let secret = util::JWT_SECRET.get().expect("JWT_SECRET not set");

    let data = decode::<Data>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|_| (StatusCode::UNAUTHORIZED, "Invalid or expired token"))?;

    Ok(AuthUser(data.claims))
}

/// Authenticates an HTTP request and optionally requires administrator
/// privileges.
///
/// The user's JWT is extracted from the request and verified. When
/// administrator access is required, the authenticated user's administrator
/// flag is checked before the request is passed to the next middleware or
/// handler.
///
/// On successful authentication, [`AuthUser`] is inserted into the request
/// extensions so that downstream handlers can access the authenticated
/// user.
///
/// # Arguments
///
/// * `req` - Incoming HTTP request.
/// * `next` - Next middleware or handler in the Axum middleware chain.
/// * `require_admin` - Indicates whether administrator privileges are
///   required.
///
/// # Returns
///
/// Returns the response produced by the next middleware or handler when
/// authentication succeeds.
///
/// # Errors
///
/// Returns `401 Unauthorized` when authentication fails.
///
/// Returns `403 Forbidden` when administrator access is required but the
/// authenticated user does not have administrator privileges.
async fn authenticate(
    mut req: Request<Body>,
    next: Next,
    require_admin: bool,
) -> Result<Response, (StatusCode, String)> {

    let user = match get_user_from_request(&req) {
        Ok(user) => user,

        Err((status, message)) => return Err((status, message.to_string())),
    };

    if require_admin && !user.0.admin {
        return Err((StatusCode::FORBIDDEN, "Access denied".into()));
    }

    req.extensions_mut().insert(user);

    Ok(next.run(req).await)
}

/// Axum middleware that requires a valid authenticated user.
///
/// This middleware verifies the JWT supplied in the request's
/// `Authorization` header and makes the resulting [`AuthUser`] available to
/// downstream handlers.
///
/// Administrator privileges are not required.
///
/// # Arguments
///
/// * `req` - Incoming HTTP request.
/// * `next` - Next middleware or handler in the Axum middleware chain.
///
/// # Returns
///
/// Returns the response generated by the next middleware or handler when
/// authentication succeeds.
///
/// Returns an authentication error when the request does not contain a
/// valid JWT.
pub async fn auth_middleware(
    req: Request<Body>,
    next: Next,
) -> Result<Response, (StatusCode, String)> {
    authenticate(req, next, false).await
}

/// Axum middleware that requires a valid administrator account.
///
/// This middleware verifies the JWT supplied in the request's
/// `Authorization` header and additionally checks that the authenticated
/// user has administrator privileges.
///
/// # Arguments
///
/// * `req` - Incoming HTTP request.
/// * `next` - Next middleware or handler in the Axum middleware chain.
///
/// # Returns
///
/// Returns the response generated by the next middleware or handler when
/// authentication succeeds and the user has administrator privileges.
///
/// Returns `401 Unauthorized` when authentication fails.
///
/// Returns `403 Forbidden` when the authenticated user is not an
/// administrator.
pub async fn admin_middleware(
    req: Request<Body>,
    next: Next,
) -> Result<Response, (StatusCode, String)> {
    authenticate(req, next, true).await
}

/// Returns authentication information for the current request.
///
/// The JWT is extracted from the request's `Authorization` header and
/// verified. If authentication succeeds, the user's ID and administrator
/// status are returned as JSON.
///
/// # Arguments
///
/// * `req` - Incoming HTTP request containing the authentication header.
///
/// # Returns
///
/// Returns `200 OK` with a JSON object containing the authenticated user's
/// ID and administrator status.
///
/// ```json
/// {
///     "user": "user-id",
///     "isAdmin": false
/// }
/// ```
///
/// Returns `401 Unauthorized` when the request is not authenticated.
pub async fn get_auth(req: Request<Body>) -> impl IntoResponse {
    let user = get_user_from_request(&req);

    if let Ok(auth_user) = user {
        (
            StatusCode::OK,
            Json(json!({
                "user": auth_user.0.user,
                "isAdmin": auth_user.0.admin
            })),
        )
            .into_response()
    } else {
        (StatusCode::UNAUTHORIZED, "Unauthorized").into_response()
    }
}

/// Extracts and verifies the authenticated user's JWT from an HTTP request.
///
/// The function reads the `Authorization` header and expects it to use the
/// `Bearer <token>` format. The extracted token is then passed to
/// [`verify_token`] for validation.
///
/// # Arguments
///
/// * `req` - HTTP request containing the `Authorization` header.
///
/// # Returns
///
/// Returns [`AuthUser`] when the request contains a valid bearer token.
///
/// # Errors
///
/// Returns `401 Unauthorized` when the `Authorization` header is missing,
/// when it does not use the `Bearer` format, or when the JWT is invalid or
/// expired.
pub fn get_user_from_request(
    req: &Request<Body>,
) -> Result<AuthUser, (StatusCode, &'static str)> {
    let auth_header = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or((StatusCode::UNAUTHORIZED, "Missing Authorization header"))?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid Bearer format"))?;

    verify_token(token)
}
