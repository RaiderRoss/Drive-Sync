use crate::{
    AppState,
    db::{create_user, get_user_by_username},
    util,
};
use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use rand::rngs::OsRng;

use axum::{
    Json,
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use chrono::{Duration, Utc};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Data {
    pub user: String,
    pub admin: bool,
    pub exp: usize,
}

#[derive(Clone)]
pub struct AuthUser(pub Data);

pub async fn register_user(
    State(state): State<AppState>,
    Json(user_data): Json<Value>,
) -> impl IntoResponse {
    let username = user_data.get("username").unwrap().as_str().unwrap();
    let password = user_data.get("password").unwrap().as_str().unwrap();
    println!("Registering user: {}", username);
    let salt = SaltString::generate(&mut OsRng);

    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .expect("Failed to hash password")
        .to_string();
    println!("Password hash: {}", hash);

    let user = create_user(&state.db, username, &hash, false).await;
    println!("User creation result: {:?}", user);
    if let Err(e) = user {
        if let sqlx::Error::RowNotFound = e {
            return (StatusCode::CONFLICT, "Username already exists").into_response();
        }

        return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create user").into_response();
    }

    let token = generate_jwt(user.unwrap(), false);

    return (StatusCode::OK, Json(json!({ "token": token }))).into_response();
}

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
        let token = generate_jwt(user_id, is_admin);
        return (StatusCode::OK, Json(json!({ "token": token }))).into_response();
    } else {
        return (StatusCode::UNAUTHORIZED, "Invalid username or password").into_response();
    }
}

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

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )
    .expect("Token encoding failed");

    token
}

fn verify_token(token: &str) -> Result<AuthUser, (StatusCode, &'static str)> {
    let secret = util::JWT_SECRET.get().expect("JWT_SECRET not set");
    let data = decode::<Data>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )
    .map_err(|_| (StatusCode::UNAUTHORIZED, "Invalid or expired token"))?;

    Ok(AuthUser(data.claims))
}

pub async fn auth_middleware(
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, (StatusCode, String)> {
    let user = match get_user_from_request(&req) {
        Ok(user) => user,
        Err((status, message)) => return Err((status, message.to_string())),
    };

    req.extensions_mut().insert(user);

    Ok(next.run(req).await)
}

pub async fn get_auth(req: Request<Body>) -> impl IntoResponse {
    let user = get_user_from_request(&req);

    if let Ok(auth_user) = user {
        (
            StatusCode::OK,
            Json(json!({ "user": auth_user.0.user, "isAdmin": auth_user.0.admin })),
        )
            .into_response()
    } else {
        (StatusCode::UNAUTHORIZED, "Unauthorized").into_response()
    }
}

pub fn get_user_from_request(req: &Request<Body>) -> Result<AuthUser, (StatusCode, &'static str)> {

    let auth_header = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or((
            StatusCode::UNAUTHORIZED,
            "Missing Authorization header".into(),
        ))?;


    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid Bearer format".into()))?;

    verify_token(token)
}
