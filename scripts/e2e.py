#!/usr/bin/env python3
"""
Medilink end-to-end walk, over real HTTP against a running local stack.

Drives one shift from a facility that does not exist yet to a timesheet that
has been disputed, upheld, corrected and approved, then reports a clinical
incident and suspends somebody for it. Every call goes through Next, the
guard, Zod and Postgres, which is the part the integration suite cannot
prove: those import the application layer directly and never load a route.

    docker compose exec web pnpm tsx scripts/bootstrap-demo.ts
    python scripts/e2e.py

Uses urllib rather than requests so it needs nothing installed, and cookies
rather than PowerShell's Invoke-WebRequest because that does not reliably
send them on Windows.
"""

import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.cookiejar import CookieJar

BASE = "http://localhost:3000"
PASSWORD = "Medilink-demo-2026"

passed = 0
failed = 0


def check(label, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  \033[32mPASS\033[0m  {label}")
    else:
        failed += 1
        print(f"  \033[31mFAIL\033[0m  {label}  {detail}")
    return condition


def section(title):
    print(f"\n\033[1m{title}\033[0m")


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
                return response.status, json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                return error.code, json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return error.code, {"raw": raw.decode(errors="replace")[:400]}
        except urllib.error.URLError as error:
            return 0, {"error": str(error)}

    def login(self, phone):
        status, body = self.call("POST", "/api/v1/auth/login", {"phone": phone, "password": PASSWORD})
        return status, body


def bootstrap():
    """Runs the demo bootstrap in the web container and reads back the ids."""
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
    """
    The console SMS adapter writes the code to the web container's log, which
    is the whole reason it exists in local: a registration flow you can drive
    without a phone in your hand.
    """
    for _ in range(10):
        logs = subprocess.run(
            ["docker", "compose", "logs", "--tail", "400", "web"],
            capture_output=True,
            text=True,
        ).stdout
        # The adapter writes the recipient and the message on consecutive
        # lines, so the code is on the line *after* the one naming the phone.
        lines = logs.splitlines()
        code = None
        for index, line in enumerate(lines):
            if phone not in line:
                continue
            for candidate in lines[index : index + 3]:
                for token in candidate.replace('"', " ").replace(",", " ").split():
                    if token.isdigit() and len(token) == 6:
                        code = token
        if code:
            return code
        time.sleep(1)
    return None


def iso(when):
    return when.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def main():
    print("\033[1mMedilink end-to-end\033[0m  " + BASE)

    section("0. Stack")
    anon = Client("anon")
    status, _ = anon.call("GET", "/api/v1/health")
    if not check("the app answers", status == 200, f"got {status}; is `docker compose up -d` running?"):
        raise SystemExit(1)

    demo = bootstrap()
    ref = demo["reference"]
    actors = {a["key"]: a for a in demo["actors"]}
    # The keys this walk signs in as, rather than a count. The count was
    # written when the bootstrap made exactly three actors and went stale the
    # moment the facility console added two more — reporting one failure on a
    # healthy stack, which is the kind that teaches a reader to ignore the
    # number.
    check(
        "demo actors exist",
        {"operations", "compliance", "superadmin"} <= actors.keys(),
        f"got {sorted(actors)}",
    )

    section("1. Authentication")
    ops = Client("operations")
    status, _ = ops.login(actors["operations"]["phone"])
    check("operations signs in", status == 200, f"got {status}")

    status, body = anon.call("GET", "/api/v1/practitioners/me")
    check(
        "an anonymous caller is told to sign in, not that it lacks a permission",
        status == 401 and body.get("error", {}).get("code") == "not_authenticated",
        str(body)[:160],
    )

    # A practitioner registers for themselves, which is the only account type
    # that can. Everything privileged had to be bootstrapped.
    stamp = int(time.time()) % 100000
    prac_phone = f"+234803{stamp:07d}"[:14]
    prac = Client("practitioner")
    status, body = prac.call(
        "POST", "/api/v1/auth/register", {"phone": prac_phone, "fullName": "E2E Practitioner", "acceptedTerms": True}
    )
    check("a practitioner registers", status in (200, 201, 202), f"{status} {str(body)[:160]}")

    code = otp_from_logs(prac_phone)
    check("the one-time code reaches the console adapter", code is not None)
    if code:
        status, verified = prac.call("POST", "/api/v1/auth/verify-phone", {"phone": prac_phone, "code": code})
        check("the phone verifies", status == 200, f"got {status}")
        status, _ = prac.call(
            "POST",
            "/api/v1/auth/set-password",
            {"phone": prac_phone, "password": PASSWORD, "setupToken": verified.get("setupToken", "")},
        )
        check("a password is set", status == 200, f"got {status}")
        status, _ = prac.login(prac_phone)
        check("the practitioner signs in", status == 200, f"got {status}")

    status, body = prac.call("GET", "/api/v1/auth/session")
    prac_user_id = body.get("user", {}).get("id")
    check("the session says who they are", bool(prac_user_id), str(body)[:200])
    # Permissions, not roles: the client hides a button because the permission
    # is absent, matching the server check exactly.
    check(
        "and what they may do",
        "timesheet.submit" in body.get("permissions", []),
        str(body.get("permissions"))[:200],
    )

    section("2. A facility, onboarded and verified")
    status, body = ops.call(
        "POST",
        "/api/v1/facilities",
        {
            "name": f"E2E Hospital {stamp}",
            "facilityTypeId": ref["facilityTypeId"],
            "cacNumber": f"RC{600000 + stamp % 90000}",
            "stateId": ref["stateId"],
            "addressLine": "12 Test Road, Abuja",
            "contactPhone": "+2348031234567",
            "representativeUserId": actors["operations"]["id"],
        },
    )
    ok = check("operations creates a facility", status in (200, 201), f"{status} {str(body)[:200]}")
    if not ok:
        raise SystemExit(1)
    facility_id = body.get("id") or body.get("facility", {}).get("id")
    check("it comes back with an id", bool(facility_id), str(body)[:160])

    compliance = Client("compliance")
    compliance.login(actors["compliance"]["phone"])
    status, body = compliance.call(
        "POST", f"/api/v1/facilities/{facility_id}/verify", {"decision": "approve"}
    )
    check("compliance verifies it", status == 200, f"{status} {str(body)[:200]}")

    # The scope boundary, on a real endpoint: the practitioner holds no grant
    # over this facility, so the same call is refused.
    status, body = prac.call(
        "POST", f"/api/v1/facilities/{facility_id}/verify", {"decision": "approve"}
    )
    check("a practitioner cannot verify a facility", status == 403, f"got {status}")

    section("3. A shift, published and filled")
    admin = Client("superadmin")
    admin.login(actors["superadmin"]["phone"])

    starts = datetime.now(timezone.utc) + timedelta(hours=3)
    status, body = admin.call(
        "POST",
        "/api/v1/service-requests",
        {
            "facilityId": facility_id,
            "professionalCategoryId": ref["professionalCategoryId"],
            "shiftType": "DAY",
            "startsAt": iso(starts),
            "endsAt": iso(starts + timedelta(hours=8)),
            "headcount": 1,
            "hourlyRateKobo": 500000,
            "urgency": "ROUTINE",
            "cancellationTerms": "Either party may cancel up to 24 hours before the shift.",
        },
    )
    ok = check("a service request is drafted", status in (200, 201), f"{status} {str(body)[:200]}")
    if not ok:
        raise SystemExit(1)
    request_id = body.get("id") or body.get("request", {}).get("id")

    status, body = admin.call(
        "POST", f"/api/v1/service-requests/{request_id}/publish", {"facilityId": facility_id}
    )
    check("and published", status == 200, f"{status} {str(body)[:200]}")

    status, body = admin.call(
        "POST",
        f"/api/v1/service-requests/{request_id}/invite",
        {"facilityId": facility_id, "userIds": [prac_user_id]},
    )
    ok = check("the practitioner is invited", status in (200, 201), f"{status} {str(body)[:200]}")
    invitation_id = None
    if ok:
        # invitePractitioners returns the list itself, not an envelope.
        payload = body if isinstance(body, list) else body.get("invitations") or []
        if payload:
            invitation_id = payload[0].get("id")

    if invitation_id:
        status, body = prac.call(
            "POST", f"/api/v1/invitations/{invitation_id}/respond", {"decision": "accept"}
        )
        check("they accept", status == 200, f"{status} {str(body)[:200]}")

    status, body = admin.call(
        "POST",
        f"/api/v1/service-requests/{request_id}/confirm",
        {"facilityId": facility_id, "userId": prac_user_id},
    )
    ok = check("the facility confirms them", status in (200, 201), f"{status} {str(body)[:200]}")
    assignment_id = body.get("id") if ok else None

    if not assignment_id:
        raise SystemExit(1)

    section("4. The shift happens")
    # The manual fallback, because a token round trip would stamp the clock
    # twice within a second and a shift of nought minutes tests no arithmetic.
    worked_from = datetime.now(timezone.utc) - timedelta(days=1, hours=9)
    status, body = admin.call(
        "POST",
        f"/api/v1/assignments/{assignment_id}/attendance/manual",
        {
            "facilityId": facility_id,
            "checkedInAt": iso(worked_from),
            "checkedOutAt": iso(worked_from + timedelta(hours=8)),
            "breakMinutes": 0,
            "reason": "Ward network was down for the whole shift; taken from the paper log.",
        },
    )
    check("a supervisor records it by hand", status in (200, 201), f"{status} {str(body)[:200]}")

    section("5. The timesheet")
    status, body = prac.call("POST", f"/api/v1/assignments/{assignment_id}/timesheet/submit", {})
    ok = check("the practitioner submits", status in (200, 201), f"{status} {str(body)[:200]}")
    if ok:
        check(
            "eight hours at the agreed rate, in kobo",
            body.get("billableMinutes") == 480 and body.get("amountKobo") == 4000000,
            f"{body.get('billableMinutes')} min, {body.get('amountKobo')} kobo",
        )

    status, body = admin.call(
        "POST",
        f"/api/v1/assignments/{assignment_id}/timesheet/review",
        {"facilityId": facility_id, "decision": "reject"},
    )
    check("a rejection with no reason is refused", status == 422, f"got {status}")

    status, body = admin.call(
        "POST",
        f"/api/v1/assignments/{assignment_id}/timesheet/review",
        {"facilityId": facility_id, "decision": "approve"},
    )
    check("approval succeeds", status == 200, f"{status} {str(body)[:200]}")

    status, body = admin.call("GET", f"/api/v1/assignments?scopeType=FACILITY&scopeId={facility_id}")
    completed = [
        a for a in (body.get("assignments") or []) if a.get("id") == assignment_id
    ]
    check(
        "and the assignment reaches COMPLETED",
        bool(completed) and completed[0].get("status") == "COMPLETED",
        str(completed)[:200],
    )

    section("6. A dispute, all the way round")
    status, body = prac.call(
        "POST",
        f"/api/v1/assignments/{assignment_id}/disputes",
        {
            "category": "HOURS",
            "reason": "The approved hours are two short: I stayed until the night staff arrived.",
        },
    )
    ok = check("the practitioner opens a case", status in (200, 201), f"{status} {str(body)[:200]}")
    dispute_id = body.get("id") if ok else None

    status, body = prac.call("GET", f"/api/v1/assignments/{assignment_id}/timesheet?scopeType=SELF")
    check(
        "the shift is now DISPUTED",
        body.get("timesheet", {}).get("attendanceStatus") == "DISPUTED",
        str(body.get("timesheet", {}).get("attendanceStatus")),
    )

    if dispute_id:
        status, body = admin.call("POST", f"/api/v1/disputes/{dispute_id}/resolve", {"outcome": "UPHELD"})
        check("resolving with no reason is refused", status == 422, f"got {status}")

        status, body = admin.call(
            "POST",
            f"/api/v1/disputes/{dispute_id}/resolve",
            {
                "outcome": "UPHELD",
                "notes": "Ward diary confirms the practitioner stayed for the handover.",
            },
        )
        check("upheld, with a reason", status == 200, f"{status} {str(body)[:200]}")

    status, body = prac.call("GET", f"/api/v1/assignments/{assignment_id}/timesheet?scopeType=SELF")
    check(
        "the figures go back to be decided again",
        body.get("timesheet", {}).get("attendanceStatus") == "SUBMITTED",
        str(body.get("timesheet", {}).get("attendanceStatus")),
    )

    status, body = admin.call(
        "POST",
        f"/api/v1/assignments/{assignment_id}/timesheet/correct",
        {
            "facilityId": facility_id,
            "checkedOutAt": iso(worked_from + timedelta(hours=10)),
            "reason": "Ward diary shows the handover ran two hours past the shift end.",
        },
    )
    ok = check("the facility corrects the hours", status == 200, f"{status} {str(body)[:200]}")
    if ok:
        check(
            "ten hours now, and revision 2",
            body.get("billableMinutes") == 600 and body.get("revision") == 2,
            f"{body.get('billableMinutes')} min, revision {body.get('revision')}",
        )

    status, body = prac.call("GET", f"/api/v1/assignments/{assignment_id}/timesheet?scopeType=SELF")
    revisions = body.get("revisions") or []
    check(
        "and the original eight hours is still readable",
        bool(revisions) and revisions[0].get("previous", {}).get("billableMinutes") == 480,
        str(revisions)[:200],
    )

    prac.call("POST", f"/api/v1/assignments/{assignment_id}/timesheet/submit", {})
    status, _ = admin.call(
        "POST",
        f"/api/v1/assignments/{assignment_id}/timesheet/review",
        {"facilityId": facility_id, "decision": "approve"},
    )
    check("the corrected timesheet is approved", status == 200, f"got {status}")

    section("7. A clinical incident")
    status, body = admin.call(
        "POST",
        "/api/v1/incidents",
        {
            "facilityId": facility_id,
            "assignmentId": assignment_id,
            "occurredAt": iso(worked_from + timedelta(hours=2)),
            "severity": "SEVERE",
            "category": "CLINICAL_PROCEDURE",
            "summary": "Patient came to harm during a procedure carried out without a second checker.",
        },
    )
    ok = check("the facility reports one", status in (200, 201), f"{status} {str(body)[:200]}")
    incident_id = body.get("id") if ok else None

    if incident_id:
        status, body = compliance.call(
            "POST",
            f"/api/v1/incidents/{incident_id}/close",
            {"outcome": "NO_ACTION", "notes": "Closing this without anybody having looked at it."},
        )
        check("a severe one cannot be closed unopened", status == 409, f"got {status}")

        compliance.call("POST", f"/api/v1/incidents/{incident_id}/review", {})
        status, body = compliance.call(
            "POST",
            f"/api/v1/incidents/{incident_id}/close",
            {
                "outcome": "PRACTITIONER_SUSPENDED",
                "notes": "Second checker was not used and the patient was harmed; suspended pending review.",
            },
        )
        check("compliance closes it with a suspension", status == 200, f"{status} {str(body)[:200]}")

    status, body = prac.call("GET", "/api/v1/auth/session")
    check(
        "the suspended practitioner's session stops working",
        status == 401,
        f"got {status}",
    )

    status, body = compliance.call("GET", f"/api/v1/users/{prac_user_id}/suspensions")
    check(
        "and the suspension says who and why",
        status == 200 and body.get("current", {}).get("reason", "").startswith("Second checker"),
        str(body)[:200],
    )

    section("8. Step-up, and the suggestion log")
    status, body = admin.call("GET", "/api/v1/suggestions?status=NEW")
    check("the log is readable", status == 200, f"{status} {str(body)[:160]}")

    status, body = admin.call(
        "POST",
        "/api/v1/suggestions",
        {"area": "MATCHING", "body": "Night shifts are never offered to me even when I am free."},
    )
    check("anybody signed in can file one", status in (200, 201), f"{status} {str(body)[:200]}")

    status, body = admin.call("GET", "/api/v1/suggestions/summary")
    check(
        "and the summary counts them by area",
        status == 200 and any(a.get("area") == "MATCHING" for a in body.get("areas", [])),
        str(body)[:200],
    )

    section("9. The audit trail")
    status, body = compliance.call("GET", "/api/v1/audit?scopeType=PLATFORM")
    check("compliance can read it", status == 200, f"{status} {str(body)[:160]}")

    status, body = admin.call("GET", "/api/v1/incidents/queue")
    check("the incident queue answers", status == 200, f"{status} {str(body)[:160]}")

    print()
    total = passed + failed
    if failed:
        print(f"\033[31m{failed} of {total} checks failed\033[0m")
        raise SystemExit(1)
    print(f"\033[32mall {total} checks passed\033[0m")


if __name__ == "__main__":
    main()
