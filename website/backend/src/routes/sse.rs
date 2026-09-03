//! # Server-Sent Events Module
//!
//! Provides the Server-Sent Events (SSE) endpoint used to deliver real-time
//! server events to connected clients.
//!
//! ## Authentication
//!
//! Clients must provide a valid JWT through the `sse_token` cookie.
//! The token is verified before the SSE connection is established.
//!
//! ## Event Scopes
//!
//! Events are filtered according to their [`EventScope`]:
//! - `Global` — sent to all connected clients.
//! - `Admin` — sent only to authenticated administrators.
//! - `User(id)` — sent only to the specified user.
//!
//! ## Keep-Alive
//!
//! The SSE connection sends a keep-alive message every 30 seconds to help
//! maintain the connection between the client and server.

use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
};

use axum_extra::extract::CookieJar;

use futures::Stream;

use std::{convert::Infallible, time::Duration};

use tokio_stream::{StreamExt, wrappers::BroadcastStream};

use crate::{AppState, EventScope, routes::auth::verify_token};

/// Establishes a Server-Sent Events connection for an authenticated user.
///
/// The handler retrieves the JWT from the `sse_token` cookie and verifies it
/// before subscribing the client to the application's broadcast event
/// channel.
///
/// Incoming events are filtered according to the authenticated user's
/// identity and administrator status. A `connected` event is sent immediately
/// after the connection is established.
///
/// # Arguments
///
/// * `jar` - Cookie jar containing the client's `sse_token` JWT.
/// * `State(state)` - Shared application state containing the event broadcast
///   channel.
///
/// # Returns
///
/// Returns an [`Sse`] stream containing events that the authenticated client
/// is authorized to receive.
///
/// The stream initially sends a `connected` event and subsequently forwards
/// applicable events from the server's broadcast channel.
///
/// # Errors
///
/// Returns [`axum::http::StatusCode::UNAUTHORIZED`] if the `sse_token` cookie
/// is missing or contains an invalid or expired JWT.
///
/// Events that cannot be received from the broadcast channel are ignored.
pub async fn events_sse(
    jar: CookieJar,
    State(state): State<AppState>,
) -> Result<
    Sse<impl Stream<Item = Result<Event, Infallible>>>,
    axum::http::StatusCode,
> {

    let token = jar
        .get("sse_token")
        .ok_or(axum::http::StatusCode::UNAUTHORIZED)?;

    let auth = verify_token(token.value())
        .map_err(|_| axum::http::StatusCode::UNAUTHORIZED)?;

    let user_id = auth.0.user.clone();

    let is_admin = auth.0.admin;

    let rx = state.events.subscribe();

    let stream = tokio_stream::once(
        Ok(Event::default()
            .event("connected")
            .data("connected")),
    )
    .chain(
        BroadcastStream::new(rx).filter_map(move |result| {
            match result {
                Ok(event) => {

                    let send = match &event.scope {
                        EventScope::Global => true,

                        EventScope::Admin => is_admin,

                        EventScope::User(id) => id == &user_id,
                    };

                    if send {
                        Some(Ok(
                            Event::default()
                                .event(event.event_type)
                                .json_data(event.data.0)
                                .unwrap(),
                        ))
                    } else {
                        None
                    }
                }

                Err(_) => None,
            }
        }),
    );

    Ok(
        Sse::new(stream).keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(30))
                .text("keep-alive"),
        ),
    )

}
