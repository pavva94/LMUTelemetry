from fastapi.testclient import TestClient

import pytest
from starlette.websockets import WebSocketDisconnect

from cloud.main import app, consume_ticket, issue_ticket, validate_production_config


def test_create_lookup_and_ticket(monkeypatch):
    monkeypatch.setenv("TEAM_ADMIN_KEY", "test-secret")
    with TestClient(app) as client:
        created = client.post(
            "/api/cloud/sessions",
            headers={"X-Team-Admin-Key": "test-secret"},
            json={"name": "Le Mans 4H", "team_name": "LMU Team", "track_name": "Le Mans"},
        )
        assert created.status_code == 200
        code = created.json()["code"]
        access_key = created.json()["access_key"]
        assert len(code) == 8
        assert len(access_key) >= 20

        lookup = client.get(
            f"/api/cloud/sessions/{code}",
            headers={"X-Session-Access-Key": access_key},
        )
        assert lookup.status_code == 200
        assert lookup.json()["team_name"] == "LMU Team"
        assert "access_key" not in lookup.json()

        ticket = client.post(
            f"/api/cloud/sessions/{code}/ticket",
            json={"display_name": "Engineer", "role": "viewer", "access_key": access_key},
        )
        assert ticket.status_code == 200
        assert ticket.json()["ticket"]


def test_live_relay(monkeypatch):
    monkeypatch.setenv("TEAM_ADMIN_KEY", "test-secret")
    with TestClient(app) as client:
        created = client.post(
            "/api/cloud/sessions",
            headers={"X-Team-Admin-Key": "test-secret"},
            json={"name": "Relay Test", "team_name": "LMU Team"},
        ).json()
        code = created["code"]
        access_key = created["access_key"]
        publisher_ticket = client.post(
            f"/api/cloud/sessions/{code}/ticket",
            json={"display_name": "Driver One", "role": "publisher", "access_key": access_key},
        ).json()["ticket"]
        viewer_ticket = client.post(
            f"/api/cloud/sessions/{code}/ticket",
            json={"display_name": "Engineer", "role": "viewer", "access_key": access_key},
        ).json()["ticket"]
        with client.websocket_connect(
            f"/ws/cloud/{code}",
            subprotocols=["lmu.telemetry.v1", f"lmu-ticket.{publisher_ticket}"],
        ) as publisher:
            with client.websocket_connect(
                f"/ws/cloud/{code}",
                subprotocols=["lmu.telemetry.v1", f"lmu-ticket.{viewer_ticket}"],
            ) as viewer:
                presence = viewer.receive_json()
                assert presence["kind"] == "presence"
                publisher.send_json({"kind": "snapshot", "payload": {"telemetry": {"connected": True}}})
                relayed = viewer.receive_json()
                assert relayed["kind"] == "snapshot"
                assert relayed["source_name"] == "Driver One"
                assert relayed["payload"]["telemetry"]["connected"] is True


def test_completed_lap_is_persisted(monkeypatch):
    monkeypatch.setenv("TEAM_ADMIN_KEY", "test-secret")
    with TestClient(app) as client:
        created = client.post(
            "/api/cloud/sessions",
            headers={"X-Team-Admin-Key": "test-secret"},
            json={"name": "Lap Test", "team_name": "LMU Team"},
        ).json()
        code = created["code"]
        access_key = created["access_key"]
        ticket = client.post(
            f"/api/cloud/sessions/{code}/ticket",
            json={"display_name": "Driver Two", "role": "publisher", "access_key": access_key},
        ).json()["ticket"]
        with client.websocket_connect(
            f"/ws/cloud/{code}",
            subprotocols=["lmu.telemetry.v1", f"lmu-ticket.{ticket}"],
        ) as publisher:
            publisher.send_json({"kind": "snapshot", "payload": {"telemetry": {"player": {"lap_number": 1, "fuel_liters": 50.0, "speed_kph": 200.0}}}})
            publisher.send_json({"kind": "snapshot", "payload": {"telemetry": {"player": {"lap_number": 1, "fuel_liters": 48.0, "speed_kph": 260.0}}}})
            publisher.send_json({"kind": "snapshot", "payload": {"telemetry": {"player": {"lap_number": 2, "last_lap_time": 215.4, "fuel_liters": 47.9, "speed_kph": 180.0}}}})
        laps = client.get(
            f"/api/cloud/sessions/{code}/laps",
            headers={"X-Session-Access-Key": access_key},
        )
        assert laps.status_code == 200
        assert laps.json()[-1]["driver_name"] == "Driver Two"
        assert laps.json()[-1]["lap_number"] == 1
        assert laps.json()[-1]["fuel_used"] == 2.0


def test_session_data_and_tickets_require_access_key(monkeypatch):
    monkeypatch.setenv("TEAM_ADMIN_KEY", "test-secret")
    with TestClient(app) as client:
        created = client.post(
            "/api/cloud/sessions",
            headers={"X-Team-Admin-Key": "test-secret"},
            json={"name": "Private Test", "team_name": "LMU Team"},
        ).json()
        code = created["code"]

        assert client.get(f"/api/cloud/sessions/{code}").status_code == 401
        assert client.get(
            f"/api/cloud/sessions/{code}/laps",
            headers={"X-Session-Access-Key": "wrong-access-key-value"},
        ).status_code == 401
        assert client.post(
            f"/api/cloud/sessions/{code}/ticket",
            json={
                "display_name": "Intruder",
                "role": "publisher",
                "access_key": "wrong-access-key-value",
                "force": True,
            },
        ).status_code == 401


def test_websocket_ticket_is_single_use():
    token = issue_ticket(
        {
            "code": "ABCDEFGH",
            "role": "viewer",
            "display_name": "Engineer",
            "nonce": "single-use-test-nonce",
        }
    )
    assert consume_ticket(token)["code"] == "ABCDEFGH"
    with pytest.raises(ValueError, match="already used"):
        consume_ticket(token)


def test_production_configuration_fails_closed(monkeypatch):
    monkeypatch.setenv("DEPLOYMENT_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///unsafe.sqlite3")
    monkeypatch.setenv("TOKEN_SECRET", "short")
    monkeypatch.setenv("TEAM_ADMIN_KEY", "short")
    with pytest.raises(RuntimeError, match="Unsafe production configuration"):
        validate_production_config()


def test_invalid_telemetry_frame_is_rejected(monkeypatch):
    monkeypatch.setenv("TEAM_ADMIN_KEY", "test-secret")
    with TestClient(app) as client:
        created = client.post(
            "/api/cloud/sessions",
            headers={"X-Team-Admin-Key": "test-secret"},
            json={"name": "Frame Test", "team_name": "LMU Team"},
        ).json()
        ticket = client.post(
            f"/api/cloud/sessions/{created['code']}/ticket",
            json={
                "display_name": "Driver",
                "role": "publisher",
                "access_key": created["access_key"],
            },
        ).json()["ticket"]
        with client.websocket_connect(
            f"/ws/cloud/{created['code']}",
            subprotocols=["lmu.telemetry.v1", f"lmu-ticket.{ticket}"],
        ) as socket:
            socket.send_text('{"kind":"snapshot","payload":{"speed":NaN}}')
            with pytest.raises(WebSocketDisconnect) as closed:
                socket.receive_text()
            assert closed.value.code == 4003


def test_http_boundary_rejects_large_requests_and_sets_headers():
    with TestClient(app) as client:
        rejected = client.post(
            "/api/cloud/sessions",
            headers={"Content-Length": "70000"},
            content=b"{}",
        )
        assert rejected.status_code == 413
        health = client.get("/api/cloud/health")
        assert health.headers["x-content-type-options"] == "nosniff"
        assert health.headers["x-frame-options"] == "DENY"
        assert health.headers["cache-control"] == "no-store"
