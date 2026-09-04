# ADR 0002 — Tigris for images and uploaded documents

**Status:** accepted · **Date:** 2026-09-04

## Context

Practitioners upload practising licences, qualification certificates,
identification and photographs; facilities upload licence documents; disputes
carry evidence attachments. These are sensitive personal data under the NDPA.

## Decision

Files live in Tigris, an S3-compatible object store. PostgreSQL holds only the
object key, checksum, content type and access metadata in
`storage.stored_objects`. MinIO stands in for Tigris in local development.

## Rationale

* S3-compatibility keeps one client and one signed-URL flow across local,
  staging and production, and leaves the provider replaceable.
* Bytes never pass through the application server: clients upload and download
  through short-lived signed URLs, which keeps large uploads off the request
  path on poor connections.
* Keeping binaries out of the database keeps backups small and restores fast.

## Consequences

* The bucket is private; there is no public read path.
* Signed URLs expire in five minutes by default, and a request is authorised
  by permission and scope before any URL is issued.
* Upload content types and sizes are allow-listed server-side.
