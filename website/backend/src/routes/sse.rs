use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
};
use axum_extra::extract::CookieJar;
use futures::Stream;
use std::{convert::Infallible, time::Duration};
use tokio_stream::{StreamExt, wrappers::BroadcastStream};

use crate::{AppState, EventScope, routes::auth::verify_token};

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