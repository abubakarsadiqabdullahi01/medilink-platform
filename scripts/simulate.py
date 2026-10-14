#!/usr/bin/env python3
"""
A complete walk through every module, over real HTTP against a running stack.

Where `e2e.py` proves one shift works end to end, this walks the whole
product in the order a real pilot would meet it: the landing page, a
practitioner registering themselves, operations onboarding a hospital,
compliance clearing both, a shift published and worked and paid, and then the
things that happen when something goes wrong — a dispute, an unattended
shift, an incident, a data request.

Every call goes through Next, the guard, Zod and Postgres. Nothing here
imports the application layer, so a route that exists only in a test is a
route this finds.

    docker compose up -d
    docker compose exec web pnpm tsx scripts/bootstrap-demo.ts
    python scripts/simulate.py

Reports PASS, FAIL or GAP. A GAP is something that is not broken but is not
there either — a step a real user could not complete without a developer.
"""

import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.cookiejar import CookieJar

BASE = "http://localhost:3000"
PASSWORD = "Medilink-demo-2026"
NEW_PASSWORD = "Simulation-2026-abcd"

passed = 0
failed = 0
gaps = []

GREEN, RED, YELLOW, BOLD, DIM, OFF = (
    "\033[32m",
    "\033[31m",
    "\033[33m",
    "\033[1m",
    "\033[2m",
    "\033[0m",
)


def check(label, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  {GREEN}PASS{OFF}  {label}")
    else:
        failed += 1
        print(f"  {RED}FAIL{OFF}  {label}  {DIM}{detail}{OFF}")
    return bool(condition)


def gap(label, detail):
    """Not a failure. Something a real user cannot do without a developer."""
    gaps.append((label, detail))
    print(f"  {YELLOW}GAP {OFF}  {label}  {DIM}{detail}{OFF}")


def note(text):
    print(f"        {DIM}{text}{OFF}")


def section(title):
    print(f"\n{BOLD}{title}{OFF}")


class Client:
    """One signed-in browser. Each actor gets their own cookie jar."""

    def __init__(self, name):
        self.name = name
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )

    def call(self, method, path, body=None):
        url = f"{BASE}{path}"
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("Content-Type", "application/json")
        try:
            with self.opener.open(request, timeout=30) as response:
                raw = response.read()
                return response.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                return error.code, json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return error.code, {"raw": raw.decode(errors="replace")[:300]}
        except urllib.error.URLError as error:
            return 0, {"error": str(error)}

    def page(self, path):
        """A page rather than an endpoint: status only."""
        try:
            with self.opener.open(f"{BASE}{path}", timeout=30) as response:
                return response.status
        except urllib.error.HTTPError as error:
            return error.code
        except urllib.error.URLError:
            return 0

    def login(self, phone, password=PASSWORD):
        return self.call(
            "POST", "/api/v1/auth/login", {"phone": phone, "password": password}
        )


def bootstrap():
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "web", "pnpm", "tsx", "scripts/bootstrap-demo.ts"],
        capture_output=True,
        text=True,
    )
    start = result.stdout.find("{")
    if start < 0:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        raise SystemExit("bootstrap failed")
    return json.loads(result.stdout[start:])


def otp_from_logs(phone):
    """The console SMS adapter writes the code to the web log — which is the
    whole reason it exists locally: a registration you can drive without a
    phone in your hand."""
    for _ in range(12):
        logs = subprocess.run(
            ["docker", "compose", "logs", "--tail", "500", "web"],
            capture_output=True,
            text=True,
        ).stdout
        lines = logs.splitlines()
        code = None
        for index, line in enumerate(lines):
            if phone not in line:
                continue
            for candidate in lines[index : index + 3]:
                for token in re.findall(r"\b\d{6}\b", candidate):
                    code = token
        if code:
            return code
        time.sleep(1)
    return None


PLACEHOLDER_PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n"
    b"trailer<</Root 1 0 R>>\n%%EOF\n"
)


def put_bytes(url, payload, content_type):
    """Straight to storage, the way the browser does it."""
    request = urllib.request.Request(url, data=payload, method="PUT")
    request.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return 200 <= response.status < 300
    except (urllib.error.HTTPError, urllib.error.URLError):
        return False


def iso(when):
    return when.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def unique_phone():
    """
    Distinct per run, so the walk is repeatable without clearing anything.

    A real Nigerian mobile: +234, then an assigned network prefix, then seven
    digits. The platform keeps an allow-list of prefixes rather than accepting
    any ten digits, so an invented number is refused — which is the rule
    working, and cost this script a run to learn.

    `805` rather than `803`, because `scripts/seed-demo.ts` puts its accounts on
    `0803 120 0xxx` and `%H%M%S%f` lands inside that block for a few seconds
    after noon UTC every day. The collision would surface as a registration
    refused for a reason that has nothing to do with the step being tested.
    """
    tail = datetime.now(timezone.utc).strftime("%H%M%S%f")[:7]
    return f"+234805{tail}"


def main():
    print(f"{BOLD}Medilink — a walk through every module{OFF}  {BASE}")
    anon = Client("anonymous")

    section("0.  The front door")
    for path, label in [
        ("/", "landing page"),
        ("/login", "sign in"),
        ("/register", "create an account"),
        ("/api/v1/health", "health check"),
    ]:
        status = anon.page(path)
        check(f"{label} loads", status == 200, f"{path} gave {status}")

    status, body = anon.call("GET", "/api/v1/practitioners/me")
    check(
        "an anonymous caller is told to sign in, not that it lacks a permission",
        status == 401 and body.get("error", {}).get("code") == "not_authenticated",
        str(body)[:140],
    )

    actors = bootstrap()["actors"]
    by_key = {actor["key"]: actor for actor in actors}
    ops = Client("operations")
    ops.login(by_key["operations"]["phone"])
    compliance = Client("compliance")
    compliance.login(by_key["compliance"]["phone"])
    admin = Client("superadmin")
    admin.login(by_key["superadmin"]["phone"])

    section("1.  Module 1 — a practitioner creates their own account")
    phone = unique_phone()
    prac = Client("practitioner")

    status, body = prac.call(
        "POST", "/api/v1/auth/register", {"phone": phone, "fullName": "Simulated Practitioner", "acceptedTerms": True}
    )
    check("registers with a phone and a name", status in (200, 201, 202), f"{status} {str(body)[:140]}")

    code = otp_from_logs(phone)
    check("a one-time code is sent", code is not None, "nothing in the console adapter's output")

    if code:
        status, verified = prac.call("POST", "/api/v1/auth/verify-phone", {"phone": phone, "code": code})
        check("the phone verifies", status == 200, f"got {status}")
        status, _ = prac.call(
            "POST",
            "/api/v1/auth/set-password",
            {"phone": phone, "password": NEW_PASSWORD, "setupToken": verified.get("setupToken", "")},
        )
        check("a password is set", status == 200, f"got {status}")
        status, _ = prac.login(phone, NEW_PASSWORD)
        check("and they can sign in", status == 200, f"got {status}")

    status, body = prac.call("GET", "/api/v1/auth/session")
    prac_id = body.get("user", {}).get("id")
    check("the session names them", bool(prac_id), str(body)[:140])
    check(
        "and carries permissions rather than a role",
        "timesheet.submit" in body.get("permissions", []),
        str(body.get("permissions"))[:140],
    )

    status, _ = anon.call("POST", "/api/v1/auth/login", {"phone": phone, "password": "wrong-one"})
    check("a wrong password is refused", status in (401, 422), f"got {status}")

    section("2.  Module 17 — what they agreed to, before anything else")
    status, body = prac.call("GET", "/api/v1/agreements")
    agreements = body.get("agreements", [])
    check("the agreements endpoint answers", status == 200, f"got {status}")
    if not agreements:
        gap(
            "no agreement has ever been published",
            "consent.agreement_versions is empty, so a new practitioner is asked to accept nothing",
        )
        status, body = admin.call(
            "PATCH",
            "/api/v1/agreements",
            {
                "kind": "PRACTITIONER_ENGAGEMENT",
                "identifier": f"engagement-sim-{int(time.time())}",
                "title": "Engagement terms",
                "body": "These are simulated engagement terms, long enough to be a real document body for the purposes of this walk. " * 2,
            },
        )
        check("an administrator can publish one", status in (200, 201), f"{status} {str(body)[:140]}")
        status, body = prac.call("GET", "/api/v1/agreements")
        agreements = body.get("agreements", [])

    if agreements:
        version = agreements[0]
        check("it is offered to the practitioner unaccepted", version.get("acceptedAt") is None)
        status, body = prac.call("POST", "/api/v1/agreements", {"versionId": version["id"]})
        check("they accept it", status in (200, 201), f"{status} {str(body)[:140]}")
        check(
            "and the version identifier is what was recorded",
            body.get("identifier") == version["identifier"],
            str(body)[:140],
        )

    status, body = prac.call("GET", "/api/v1/consent")
    purposes = {row["purpose"]: row for row in body.get("consent", [])}
    check("consent lists every purpose", len(purposes) == 4, str(list(purposes))[:140])
    check(
        "and does not call a legal obligation consent",
        purposes.get("IDENTITY_VERIFICATION", {}).get("withdrawable") is False,
        str(purposes.get("IDENTITY_VERIFICATION"))[:140],
    )

    status, _ = prac.call(
        "POST", "/api/v1/consent", {"purpose": "CREDENTIAL_SHARING", "granted": True}
    )
    check("they consent to sharing credentials", status == 200, f"got {status}")

    status, body = prac.call(
        "POST",
        "/api/v1/consent",
        {"purpose": "IDENTITY_VERIFICATION", "granted": False, "note": "I would rather not."},
    )
    check(
        "and cannot withdraw what never rested on consent",
        status == 409,
        f"{status} {str(body)[:140]}",
    )

    section("3.  Modules 2 and 3 — profile, identity and credentials")
    status, body = anon.call("GET", "/api/v1/reference")
    check("the vocabularies need a session", status == 401, f"got {status}")
    status, body = prac.call("GET", "/api/v1/reference")
    check("and are readable once signed in", status == 200, f"got {status}")
    category_id = (body.get("professionalCategories") or [{}])[0].get("id")
    state_id = (body.get("states") or [{}])[0].get("id")
    credential_types = body.get("credentialTypes") or []

    status, body = prac.call(
        "POST",
        "/api/v1/practitioners/me",
        {
            "professionalCategoryId": category_id,
            "yearsOfExperience": 6,
            "homeStateId": state_id,
            "travelPreference": "ANYWHERE",
            "bio": "Simulated locum cover.",
        },
    )
    check("they create a profile", status in (200, 201), f"{status} {str(body)[:140]}")

    status, body = prac.call("GET", "/api/v1/practitioners/eligibility?scopeType=SELF")
    blockers = body.get("blockers", [])
    check("eligibility says why they cannot work yet", len(blockers) > 0, str(body)[:140])
    note(f"blockers: {', '.join(blockers)}")

    status, body = compliance.call(
        "POST",
        "/api/v1/practitioners/verification/identity",
        {"userId": prac_id, "nin": f"1{int(time.time()) % 10000000000:010d}", "nameMatch": True},
    )
    check("compliance records identity", status in (200, 201), f"{status} {str(body)[:140]}")

    status, body = compliance.call(
        "POST",
        "/api/v1/practitioners/verification/registration",
        {
            "userId": prac_id,
            "regulator": "MDCN",
            "folioNumber": f"MDCN/SIM/{int(time.time())}",
            "registrationStatus": "ACTIVE",
            "expiresAt": iso(datetime.now(timezone.utc) + timedelta(days=300)),
        },
    )
    check("and the practising registration", status in (200, 201), f"{status} {str(body)[:140]}")

    # Every type verified against an external register takes a reference
    # number rather than a file — including nin_slip, which is mandatory for
    # a doctor and needs no NIMC call to submit.
    for reference_type in [
        t for t in credential_types if t.get("verificationMethod") != "document_review"
    ]:
        status, body = prac.call(
            "POST",
            "/api/v1/credentials",
            {
                "credentialTypeId": reference_type["id"],
                "referenceNumber": f"{reference_type['key'][:6].upper()}/{int(time.time() * 1000) % 10000000}",
            },
        )
        submitted = check(
            f"{reference_type['key']} submits with a reference number",
            status in (200, 201),
            f"{status} {str(body)[:140]}",
        )
        submission_id = body.get("id")

        if submitted and submission_id:
            status, body = compliance.call(
                "POST", f"/api/v1/credentials/{submission_id}/review", {"decision": "approve"}
            )
            check(f"compliance verifies {reference_type['key']}", status == 200, f"{status} {str(body)[:140]}")

    for document_type in [
        t for t in credential_types if t.get("verificationMethod") == "document_review"
    ]:
        status, body = prac.call(
            "POST",
            "/api/v1/credentials",
            {"credentialTypeId": document_type["id"], "referenceNumber": "GS/SIM/1"},
        )
        check(
            f"{document_type['key']} is refused without a document",
            status == 422 and body.get("error", {}).get("code") == "document_required",
            f"{status} {str(body)[:140]}",
        )

        # The same three steps the upload control performs: ask for a signed
        # URL, send the bytes straight to storage, submit the key.
        status, signed = prac.call(
            "POST",
            "/api/v1/credentials/document-upload-url",
            {
                "filename": f"{document_type['key']}.pdf",
                "contentType": "application/pdf",
                "sizeBytes": len(PLACEHOLDER_PDF),
            },
        )
        got_url = check(
            "a signed upload URL is issued", status in (200, 201), f"{status} {str(signed)[:140]}"
        )

        if got_url:
            uploaded = put_bytes(signed["uploadUrl"], PLACEHOLDER_PDF, "application/pdf")
            check("the file goes straight to storage", uploaded, "storage refused the PUT")

            status, body = prac.call(
                "POST",
                "/api/v1/credentials",
                {
                    "credentialTypeId": document_type["id"],
                    "documentObjectKey": signed["objectKey"],
                },
            )
            submitted_doc = check(
                f"and {document_type['key']} submits with it",
                status in (200, 201),
                f"{status} {str(body)[:140]}",
            )
            if submitted_doc and body.get("id"):
                status, _ = compliance.call(
                    "POST", f"/api/v1/credentials/{body['id']}/review", {"decision": "approve"}
                )
                check("compliance verifies the document", status == 200, f"got {status}")

    status, body = prac.call("GET", "/api/v1/practitioners/eligibility?scopeType=SELF")
    remaining = body.get("blockers", [])
    check(
        "and every blocker clears, through the product alone",
        remaining == [],
        f"still blocked by {remaining}",
    )

    section("4.  Module 5 — when they can work")
    status, body = prac.call(
        "POST",
        "/api/v1/availability/slots",
        # 1440 is midnight at the close of the day, so Monday ends
        # exactly where Tuesday begins and the two join. 1439 leaves a
        # one-minute hole that every overnight shift falls through.
        {"kind": "RECURRING_WEEKLY", "dayOfWeek": 1, "startMinute": 0, "endMinute": 1440},
    )
    check("they set a weekly pattern", status in (200, 201), f"{status} {str(body)[:140]}")
    for day in (2, 3, 4, 5):
        prac.call(
            "POST",
            "/api/v1/availability/slots",
            {"kind": "RECURRING_WEEKLY", "dayOfWeek": day, "startMinute": 0, "endMinute": 1440},
        )

    status, body = prac.call(
        "POST",
        "/api/v1/availability/blocks",
        {
            "startsAt": iso(datetime.now(timezone.utc) + timedelta(days=200)),
            "endsAt": iso(datetime.now(timezone.utc) + timedelta(days=207)),
            "reason": "Annual leave, booked before joining the platform.",
        },
    )
    check("and block a week off with a reason", status in (200, 201), f"{status} {str(body)[:140]}")

    status, body = prac.call("GET", "/api/v1/availability?scopeType=SELF")
    check(
        "both come back together",
        len(body.get("slots", [])) >= 5 and len(body.get("blocks", [])) >= 1,
        str(body)[:140],
    )

    section("5.  Module 4 — a facility, onboarded and verified")
    status, body = prac.call(
        "POST",
        "/api/v1/facilities",
        {
            "name": "A hospital a practitioner should not be able to create",
            "facilityTypeId": "00000000-0000-0000-0000-000000000000",
            "cacNumber": "RC000001",
            "stateId": state_id,
            "addressLine": "Nowhere",
            "contactPhone": "+2348030000000",
            "representativeUserId": prac_id,
        },
    )
    check(
        "a practitioner cannot onboard a hospital for somebody else",
        status == 403,
        f"got {status}",
    )

    status, body = prac.call("GET", "/api/v1/reference")
    self_type_id = (body.get("facilityTypes") or [{}])[0].get("id")
    self_state_id = (body.get("states") or [{}])[0].get("id")
    own_stamp = datetime.now(timezone.utc).strftime("%H%M%S%f")[:8]
    status, body = prac.call(
        "POST",
        "/api/v1/facilities/register",
        {
            "name": f"Self Registered Clinic {own_stamp}",
            "facilityTypeId": self_type_id,
            "cacNumber": f"RC99{own_stamp}",
            "stateId": self_state_id,
            "addressLine": "9 Self Service Road, Lagos",
            "contactPhone": "+2348030000009",
        },
    )
    self_registered = check(
        "but they can register one for themselves", status in (200, 201), f"{status} {str(body)[:140]}"
    )
    own_facility_id = body.get("id")

    if self_registered:
        check("and it lands pending rather than live", body.get("status") == "PENDING", str(body)[:140])

        status, body = prac.call(
            "POST",
            "/api/v1/service-requests",
            {
                "facilityId": own_facility_id,
                "professionalCategoryId": category_id,
                "shiftType": "DAY",
                "startsAt": iso(datetime.now(timezone.utc) + timedelta(hours=3)),
                "endsAt": iso(datetime.now(timezone.utc) + timedelta(hours=11)),
                "headcount": 1,
                "hourlyRateKobo": 700000,
                "cancellationTerms": "Either party may cancel up to 24 hours before the shift.",
            },
        )
        if status in (200, 201) and body.get("id"):
            status, body = prac.call(
                "POST",
                f"/api/v1/service-requests/{body['id']}/publish",
                {"facilityId": own_facility_id},
            )
        check(
            "an unverified facility still cannot publish a shift",
            status in (403, 409, 422),
            f"got {status} {str(body)[:140]}",
        )

        status, body = prac.call(
            "POST",
            "/api/v1/facilities/register",
            {
                "name": "A second one while the first is pending",
                "facilityTypeId": self_type_id,
                "cacNumber": f"RC98{own_stamp}",
                "stateId": self_state_id,
                "addressLine": "10 Self Service Road, Lagos",
                "contactPhone": "+2348030000010",
            },
        )
        check("and cannot register a second while one is pending", status == 409, f"got {status}")

    status, body = prac.call("GET", "/api/v1/reference")
    facility_type_id = (body.get("facilityTypes") or [{}])[0].get("id")

    stamp = datetime.now(timezone.utc).strftime("%H%M%S")
    status, body = ops.call(
        "POST",
        "/api/v1/facilities",
        {
            "name": f"Simulated General Hospital {stamp}",
            "facilityTypeId": facility_type_id,
            "cacNumber": f"RC88{stamp}",
            "stateId": state_id,
            "addressLine": "1 Simulation Way, Abuja",
            "contactPhone": "+2348030000001",
            "representativeUserId": by_key["operations"]["id"],
        },
    )
    created = check("operations onboards one", status in (200, 201), f"{status} {str(body)[:140]}")
    facility_id = body.get("id")
    if not created or not facility_id:
        raise SystemExit(1)

    scheduler = Client("scheduler")
    scheduler.login(by_key["scheduler"]["phone"])
    status, body = scheduler.call(
        "POST",
        "/api/v1/service-requests",
        {
            "facilityId": facility_id,
            "professionalCategoryId": category_id,
            "shiftType": "DAY",
            "startsAt": iso(datetime.now(timezone.utc) + timedelta(hours=3)),
            "endsAt": iso(datetime.now(timezone.utc) + timedelta(hours=11)),
            "headcount": 1,
            "hourlyRateKobo": 700000,
            "cancellationTerms": "Either party may cancel up to 24 hours before the shift.",
        },
    )
    check(
        "a scheduler at another facility cannot publish here",
        status == 403,
        f"got {status}",
    )

    status, body = compliance.call(
        "POST", f"/api/v1/facilities/{facility_id}/verify", {"decision": "approve"}
    )
    check("compliance verifies the facility", status == 200, f"{status} {str(body)[:140]}")

    # Granting somebody access to the facility just created. Until this
    # existed, operations could onboard a hospital and then had no way to let
    # anybody work in it — every scheduler had to be made by a script.
    ward = Client("ward manager")
    ward_phone = unique_phone()
    ward.call("POST", "/api/v1/auth/register", {"phone": ward_phone, "fullName": "Simulated Ward Manager", "acceptedTerms": True})
    ward_code = otp_from_logs(ward_phone)
    if ward_code:
        _, ward_verified = ward.call("POST", "/api/v1/auth/verify-phone", {"phone": ward_phone, "code": ward_code})
        ward.call(
            "POST",
            "/api/v1/auth/set-password",
            {"phone": ward_phone, "password": NEW_PASSWORD, "setupToken": ward_verified.get("setupToken", "")},
        )
        ward.login(ward_phone, NEW_PASSWORD)
    status, body = ward.call("GET", "/api/v1/auth/session")
    ward_id = body.get("user", {}).get("id")

    # role.grant sits behind step-up: it is the permission that decides what
    # everybody else may do, so a live session alone is not enough.
    status, body = admin.call(
        "GET", f"/api/v1/grants?scopeType=FACILITY&scopeId={facility_id}"
    )
    check("granting is refused without step-up", status == 401 and body.get("error", {}).get("code") == "step_up_required", f"{status} {str(body)[:140]}")

    status, _ = admin.call("POST", "/api/v1/auth/step-up", {"password": PASSWORD})
    check("an administrator confirms their password", status == 200, f"got {status}")

    status, body = admin.call(
        "GET", f"/api/v1/grants/find?scopeType=FACILITY&scopeId={facility_id}&phone={ward_phone.replace('+', '%2B')}"
    )
    check("an administrator can find them by phone number", status == 200, f"{status} {str(body)[:140]}")

    status, body = admin.call(
        "POST",
        "/api/v1/grants",
        {
            "userId": ward_id,
            "roleKey": "facility_owner",
            "scopeType": "FACILITY",
            "scopeId": facility_id,
        },
    )
    granted = check("and grant them the facility", status in (200, 201), f"{status} {str(body)[:140]}")

    status, body = admin.call(
        "POST",
        "/api/v1/grants",
        {"userId": ward_id, "roleKey": "facility_owner", "scopeType": "FACILITY"},
    )
    check("a facility grant with no facility is refused", status == 422, f"got {status}")

    # Step up first, or the escalation check is never reached.
    ward.call("POST", "/api/v1/auth/step-up", {"password": NEW_PASSWORD})
    status, body = ward.call(
        "POST",
        "/api/v1/grants",
        {"userId": prac_id, "roleKey": "administrator", "scopeType": "PLATFORM"},
    )
    check(
        "and nobody can grant a permission they do not hold themselves",
        status in (403, 422),
        f"{status} {str(body)[:140]}",
    )

    if granted:
        status, body = ward.call("GET", "/api/v1/auth/session")
        check(
            "the new grant is live in their session",
            # timesheet.approve, not attendance.record: a practitioner holds
            # the latter at SELF, so it would pass without the grant.
            "timesheet.approve" in body.get("permissions", []),
            str(body.get("permissions"))[:140],
        )

    section("6.  Module 11 — what the facility pays above the agreed rate")
    status, body = ops.call(
        "POST",
        "/api/v1/rate-cards",
        {
            "facilityId": facility_id,
            "name": "Nights at 1.5x",
            "nightMultiplierBp": 15000,
        },
    )
    check("a rate card is set", status in (200, 201), f"{status} {str(body)[:140]}")

    status, body = ops.call(
        "POST",
        "/api/v1/rate-cards",
        {"facilityId": facility_id, "name": "A rate cut in disguise", "nightMultiplierBp": 9000},
    )
    check("a multiple below par is refused", status == 422, f"got {status}")

    section("7.  Module 6 — a shift, published")
    starts = datetime.now(timezone.utc) + timedelta(hours=3)
    ends = starts + timedelta(hours=8)
    status, body = ops.call(
        "POST",
        "/api/v1/service-requests",
        {
            "facilityId": facility_id,
            "professionalCategoryId": category_id,
            "shiftType": "DAY",
            "startsAt": iso(starts),
            "endsAt": iso(ends),
            "headcount": 1,
            "hourlyRateKobo": 10000,
            "cancellationTerms": "Either party may cancel up to 24 hours before the shift.",
        },
    )
    check(
        "a rate below the floor is refused",
        status == 422 and "floor" in str(body).lower(),
        f"{status} {str(body)[:140]}",
    )

    status, body = ops.call(
        "POST",
        "/api/v1/service-requests",
        {
            "facilityId": facility_id,
            "professionalCategoryId": category_id,
            "shiftType": "DAY",
            "startsAt": iso(starts),
            "endsAt": iso(ends),
            "headcount": 1,
            "hourlyRateKobo": 700000,
            "urgency": "ROUTINE",
            "cancellationTerms": "Either party may cancel up to 24 hours before the shift.",
            "notes": "Medical ward. Handover at the start of the shift.",
        },
    )
    check("a shift is drafted", status in (200, 201), f"{status} {str(body)[:140]}")
    request_id = body.get("id")

    status, body = ops.call(
        "POST", f"/api/v1/service-requests/{request_id}/publish", {"facilityId": facility_id}
    )
    check("and published", status == 200, f"{status} {str(body)[:140]}")

    section("8.  Module 7 — matched, offered, confirmed")
    status, body = ops.call(
        "POST", f"/api/v1/service-requests/{request_id}/match", {"facilityId": facility_id}
    )
    check("the matcher runs", status in (200, 201), f"{status} {str(body)[:140]}")
    ranked = body.get("ranked", [])
    excluded = body.get("excluded", [])
    note(f"{len(ranked)} ranked, {len(excluded)} excluded of {body.get('consideredCount')} considered")

    if ranked:
        check(
            "and every candidate carries the factors behind their score",
            all(len(row.get("factors", [])) >= 4 for row in ranked),
            str(ranked[0])[:160],
        )
    ours = next((row for row in ranked if row["userId"] == prac_id), None)
    if ours is None:
        reasons = next(
            (row.get("reasons") for row in excluded if row.get("userId") == prac_id), None
        )
        if reasons == ["not_eligible"]:
            note("excluded for not_eligible — the credential gap above, not a matcher fault")
        else:
            check(
                "our practitioner is rankable",
                False,
                f"excluded for {reasons}" if reasons else "not considered at all",
            )
    else:
        check("our practitioner is ranked", True)

    status, body = ops.call(
        "POST",
        f"/api/v1/service-requests/{request_id}/invite",
        {"facilityId": facility_id, "userIds": [prac_id]},
    )
    invited = check("they are offered the shift", status in (200, 201), f"{status} {str(body)[:140]}")
    invitation_id = (body[0] if isinstance(body, list) and body else {}).get("id")

    if invited and invitation_id:
        status, body = prac.call(
            "POST", f"/api/v1/invitations/{invitation_id}/respond", {"decision": "accept"}
        )
        check("they accept", status == 200, f"{status} {str(body)[:140]}")

        status, body = ops.call(
            "POST",
            f"/api/v1/service-requests/{request_id}/confirm",
            {"facilityId": facility_id, "userId": prac_id},
        )
        check("and the facility confirms them", status in (200, 201), f"{status} {str(body)[:140]}")
        assignment_id = body.get("id")
    else:
        assignment_id = None

    if not assignment_id:
        print(f"\n{RED}Cannot continue without a confirmed assignment.{OFF}")
        summarise()
        return

    section("9.  Module 9 — attendance")
    status, body = prac.call(
        "POST",
        f"/api/v1/assignments/{assignment_id}/attendance/token",
        {"facilityId": facility_id, "purpose": "CHECK_IN"},
    )
    check("a practitioner cannot issue their own check-in code", status == 403, f"got {status}")

    status, body = ward.call(
        "POST",
        f"/api/v1/assignments/{assignment_id}/attendance/token",
        {"facilityId": facility_id, "purpose": "CHECK_IN"},
    )
    issued = check("the ward issues one", status in (200, 201), f"{status} {str(body)[:140]}")
    token = body.get("code")

    if issued and token:
        status, body = prac.call(
            "POST",
            f"/api/v1/assignments/{assignment_id}/attendance/present",
            {"purpose": "CHECK_IN", "code": "000000"},
        )
        check("a wrong code is refused", status in (409, 422), f"got {status}")

        status, body = prac.call(
            "POST",
            f"/api/v1/assignments/{assignment_id}/attendance/present",
            {"purpose": "CHECK_IN", "code": token},
        )
        check("the real one checks them in", status == 200, f"{status} {str(body)[:140]}")

    # The shift is still in the future, so the hours are recorded by hand —
    # the same path a ward uses when the network is down.
    worked_from = datetime.now(timezone.utc) - timedelta(hours=9)
    status, body = ward.call(
        "POST",
        f"/api/v1/assignments/{assignment_id}/attendance/manual",
        {
            "facilityId": facility_id,
            "checkedInAt": iso(worked_from),
            "checkedOutAt": iso(worked_from + timedelta(hours=8)),
            "breakMinutes": 30,
            "reason": "Simulated walk: the hours are recorded from the ward log.",
        },
    )
    check("and the ward records the hours by hand", status == 200, f"{status} {str(body)[:140]}")

    status, body = ward.call(
        "POST",
        f"/api/v1/assignments/{assignment_id}/attendance/manual",
        {
            "facilityId": facility_id,
            "checkedInAt": iso(worked_from),
            "checkedOutAt": iso(worked_from + timedelta(hours=8)),
            "reason": "short",
        },
    )
    check("a manual record with no real reason is refused", status == 422, f"got {status}")

    section("10.  Module 10 — the timesheet")
    status, body = prac.call("POST", f"/api/v1/assignments/{assignment_id}/timesheet/submit", {})
    check("the practitioner submits", status in (200, 201), f"{status} {str(body)[:140]}")
    note(f"{body.get('billableMinutes')} billable minutes, {body.get('amountKobo')} kobo")

    status, body = ward.call(
        "POST",
        f"/api/v1/assignments/{assignment_id}/timesheet/review",
        {"facilityId": facility_id, "decision": "reject"},
    )
    check("a rejection with no reason is refused", status == 422, f"got {status}")

    status, body = ward.call(
        "POST",
        f"/api/v1/assignments/{assignment_id}/timesheet/review",
        {"facilityId": facility_id, "decision": "approve"},
    )
    check("and approval completes the shift", status == 200, f"{status} {str(body)[:140]}")

    section("11.  Module 12 — invoiced, paid, settled")
    finance = Client("finance")
    status, _ = finance.login(by_key["superadmin"]["phone"])
    # Issuing, recording payment and preparing or releasing a payout all need the
    # password confirmed again (payout.manage is a step-up permission).
    finance.call("POST", "/api/v1/auth/step-up", {"password": PASSWORD})
    period_start = datetime.now(timezone.utc) - timedelta(days=45)
    period_end = datetime.now(timezone.utc) + timedelta(days=45)

    status, body = finance.call(
        "POST",
        "/api/v1/invoices",
        {
            "facilityId": facility_id,
            "periodStart": iso(period_start),
            "periodEnd": iso(period_end),
        },
    )
    raised = check("an invoice is raised from approved work", status in (200, 201), f"{status} {str(body)[:140]}")
    invoice_id = body.get("id")
    gross = body.get("grossKobo")
    note(f"gross {gross} kobo across {len(body.get('lines', []))} line(s), fee {body.get('platformFeeKobo')}")

    if raised and invoice_id:
        # What a payment record has to say: the bank's reference, the amount, the
        # date the money arrived (Lagos) and who paid.
        payment = {
            "facilityId": facility_id,
            "paymentReference": f"SIM-TRF-{invoice_id[:8]}",
            "amountKobo": gross,
            "paidOn": datetime.now(timezone(timedelta(hours=1))).date().isoformat(),
            "payerName": "Simulated facility",
        }
        status, body = finance.call("POST", f"/api/v1/invoices/{invoice_id}/pay", payment)
        check("a draft cannot be paid before it is issued", status == 409, f"got {status}")

        status, body = finance.call(
            "POST", f"/api/v1/invoices/{invoice_id}/issue", {"facilityId": facility_id}
        )
        check("it is issued", status == 200, f"{status} {str(body)[:140]}")

        status, body = finance.call(
            "POST", f"/api/v1/invoices/{invoice_id}/pay", {**payment, "amountKobo": (gross or 0) - 100}
        )
        check("a payment for less than the invoice is refused", status == 422, f"got {status}")

        status, body = finance.call("POST", f"/api/v1/invoices/{invoice_id}/pay", payment)
        check("and recorded as paid", status == 200, f"{status} {str(body)[:140]}")

        status, body = finance.call("POST", "/api/v1/payouts", {"practitionerId": prac_id})
        prepared = check("a payout is prepared", status in (200, 201), f"{status} {str(body)[:140]}")
        payout_id = body.get("id")
        note(f"{body.get('amountKobo')} kobo owed")

        if prepared and payout_id:
            # The person who prepared a payout cannot release it (UXO-03): a second
            # finance-capable person does, here the operations officer.
            status, body = finance.call("POST", f"/api/v1/payouts/{payout_id}/release", {})
            check(
                "the person who prepared a payout cannot release it",
                status == 403 and body.get("error", {}).get("code") == "second_approver_required",
                f"{status} {str(body)[:140]}",
            )
            ops.call("POST", "/api/v1/auth/step-up", {"password": PASSWORD})
            status, body = ops.call("POST", f"/api/v1/payouts/{payout_id}/release", {})
            check("and a colleague can release it through the gateway", status == 200, f"{status} {str(body)[:140]}")
            check(
                "the reference says it is a stub, so nobody mistakes it for a bank one",
                str(body.get("providerReference", "")).startswith("stub-"),
                str(body)[:140],
            )

    section("12.  Module 14 — a dispute")
    status, body = prac.call(
        "POST",
        f"/api/v1/assignments/{assignment_id}/disputes",
        {"category": "HOURS", "reason": "short"},
    )
    check("a dispute with no real reason is refused", status == 422, f"got {status}")

    status, body = prac.call(
        "POST",
        f"/api/v1/assignments/{assignment_id}/disputes",
        {
            "category": "HOURS",
            "reason": "The approved hours are short by one: I stayed for the handover.",
        },
    )
    opened = check("the practitioner opens one", status in (200, 201), f"{status} {str(body)[:140]}")
    dispute_id = body.get("id")

    if opened and dispute_id:
        # dispute.manage sits with operations rather than compliance.
        status, body = ops.call("GET", "/api/v1/disputes")
        check(
            "it reaches the adjudicator's queue",
            any(row.get("id") == dispute_id for row in body.get("disputes", [])),
            str(body)[:140],
        )

        status, body = ops.call(
            "POST", f"/api/v1/disputes/{dispute_id}/resolve", {"outcome": "UPHELD", "notes": "no"}
        )
        check("a finding with no reason is refused", status in (409, 422), f"got {status}")

        status, body = ops.call(
            "POST",
            f"/api/v1/disputes/{dispute_id}/resolve",
            {
                "outcome": "DISMISSED",
                "notes": "The ward diary shows the handover finished on time, as recorded.",
            },
        )
        check("and it is resolved with one", status == 200, f"{status} {str(body)[:140]}")

    section("13.  Module 15 — a clinical incident")
    status, body = ops.call(
        "POST",
        "/api/v1/incidents",
        {
            "facilityId": facility_id,
            "occurredAt": iso(datetime.now(timezone.utc) - timedelta(days=1)),
            "severity": "NEAR_MISS",
            "category": "MEDICATION",
            "summary": "Wrong strength drawn up and caught by the second checker before it reached the patient.",
        },
    )
    reported = check("a near miss is reported with nobody named", status in (200, 201), f"{status} {str(body)[:140]}")
    incident_id = body.get("id")

    if reported and incident_id:
        status, body = compliance.call("GET", "/api/v1/incidents/queue")
        check(
            "it reaches compliance",
            any(row.get("id") == incident_id for row in body.get("incidents", [])),
            str(body)[:140],
        )

        status, body = compliance.call(
            "POST",
            f"/api/v1/incidents/{incident_id}/close",
            {
                "outcome": "SYSTEM_ISSUE",
                "notes": "Two near-identical vials stored side by side. Separated, and the label changed.",
            },
        )
        check("and closes as a system issue rather than somebody's fault", status == 200, f"{status} {str(body)[:140]}")

    section("14.  Module 18 — the suggestion log")
    status, body = prac.call(
        "POST",
        "/api/v1/suggestions",
        {"area": "MATCHING", "body": "I was offered a shift in a state I said I would not travel to."},
    )
    check("a practitioner can say what did not work", status in (200, 201), f"{status} {str(body)[:140]}")

    # suggestion.triage sits with operations rather than compliance.
    status, body = ops.call("GET", "/api/v1/suggestions?status=NEW")
    check("and it reaches the pilot log", status == 200, f"got {status}")

    section("15.  Module 17 — their data, and the trail")
    status, body = prac.call("GET", "/api/v1/me/export")
    exported = check("a practitioner can export everything held about them", status == 200, f"got {status}")
    if exported:
        keys = set(body.keys())
        check(
            "it contains their account, profile and consent",
            {"account", "profile", "consent"}.issubset(keys),
            str(sorted(keys))[:160],
        )
        check(
            "and never the audit trail or the ledger",
            "auditTrail" not in keys and "ledger" not in keys,
            str(sorted(keys))[:160],
        )
        check(
            "with the omission named rather than left as a gap",
            len(body.get("notIncluded", {})) >= 2,
            str(body.get("notIncluded"))[:140],
        )

    status, body = prac.call("GET", "/api/v1/me/erasure")
    check("the erasure check answers before they ask", status == 200, f"got {status}")
    note(f"can proceed: {body.get('canProceed')}, blockers: {[b.get('code') for b in body.get('blockers', [])]}")

    status, body = prac.call(
        "POST", "/api/v1/data-requests", {"kind": "ACCESS", "detail": "A copy of everything."}
    )
    raised_request = check("they raise a formal request", status in (200, 201), f"{status} {str(body)[:140]}")
    request_ref = body.get("id")
    if raised_request:
        days = None
        try:
            due = datetime.fromisoformat(body["dueBy"].replace("Z", "+00:00"))
            received = datetime.fromisoformat(body["receivedAt"].replace("Z", "+00:00"))
            days = round((due - received).days)
        except Exception:
            pass
        check("with a statutory deadline a month out", days == 30, f"got {days} days")

    status, body = compliance.call("GET", "/api/v1/data-requests?status=RECEIVED")
    check(
        "it reaches compliance's queue",
        any(row.get("id") == request_ref for row in body.get("requests", [])),
        str(body)[:140],
    )

    if request_ref:
        status, body = compliance.call(
            "POST", f"/api/v1/data-requests/{request_ref}/close", {"status": "COMPLETED", "outcome": "no"}
        )
        check("closing with no real outcome is refused", status == 422, f"got {status}")

        status, body = compliance.call(
            "POST",
            f"/api/v1/data-requests/{request_ref}/close",
            {"status": "COMPLETED", "outcome": "Export produced and sent to their registered number."},
        )
        check("and it is answered with one", status == 200, f"{status} {str(body)[:140]}")

    status, body = prac.call("GET", "/api/v1/audit?scopeType=PLATFORM")
    check("a practitioner cannot read the platform audit trail", status == 403, f"got {status}")

    status, body = compliance.call("GET", "/api/v1/audit?scopeType=PLATFORM&limit=200")
    entries = body.get("entries", [])
    check("compliance can", status == 200, f"got {status}")
    actions = {row.get("action") for row in entries}
    for action in ("consent.granted", "agreement.accepted", "role.granted"):
        check(f"the platform trail recorded {action}", action in actions, str(sorted(actions))[:200])

    # An invoice is audited at the scope it affects, so it is in the
    # facility's trail rather than the platform's.
    # compliance, not operations: audit.read is compliance's. A PLATFORM
    # grant covers a FACILITY-scoped read, which is the ancestry rule working.
    status, body = compliance.call(
        "GET", f"/api/v1/audit?scopeType=FACILITY&scopeId={facility_id}&limit=200"
    )
    check("a facility's own trail is readable at its scope", status == 200, f"{status} {str(body)[:140]}")
    facility_actions = {row.get("action") for row in body.get("entries", [])}
    for action in ("facility.created", "invoice.created"):
        check(
            f"the facility trail recorded {action}",
            action in facility_actions,
            str(sorted(facility_actions))[:200],
        )

    section("16.  The consoles")
    for path, who, client in [
        ("/admin", "operations", ops),
        ("/admin/finance", "operations", ops),
        ("/admin/data-requests", "compliance", compliance),
        ("/facility", "a facility user", ops),
        ("/facility/rates", "a facility user", ops),
        ("/practitioner", "a practitioner", prac),
        ("/practitioner/privacy", "a practitioner", prac),
    ]:
        status = client.page(path)
        check(f"{path} renders for {who}", status == 200, f"got {status}")


def summarise():
    print(f"\n{BOLD}Result{OFF}")
    print(f"  {GREEN}{passed} passed{OFF}   {RED}{failed} failed{OFF}   {YELLOW}{len(gaps)} gaps{OFF}")
    if gaps:
        print(f"\n{BOLD}Gaps — not broken, but a real user cannot get past them{OFF}")
        for label, detail in gaps:
            print(f"  {YELLOW}·{OFF} {label}\n    {DIM}{detail}{OFF}")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    finally:
        summarise()
