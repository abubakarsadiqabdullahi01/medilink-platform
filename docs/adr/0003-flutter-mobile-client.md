# ADR 0003 — Flutter for the mobile client

**Status:** accepted · **Date:** 2026-09-04

## Context

Practitioners are the mobile-first side of the platform. The earlier plan named
Kotlin, which commits to Android only and to a second implementation if iOS is
ever needed.

## Decision

The mobile client is built in Flutter, released on Android first. Phase 1 still
ships the Progressive Web App; the Flutter client follows once the API is
stable.

## Rationale

* One Dart codebase serves Android now and iOS later without rewriting the
  same practitioner journeys twice.
* Android is prioritised on Nigerian device share.
* Delivery constraints are unchanged: the client holds no business rules and
  consumes the same versioned API as the web application.

## Consequences

* Contract tests run against the same API suite as web, so a rule change
  cannot require a client release.
* Offline tolerance — queued drafts, availability and check-in events — is the
  client's responsibility, and the server must accept idempotent replays.
