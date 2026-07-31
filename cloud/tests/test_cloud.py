from fastapi.testclient import TestClient

from cloud.main import app


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
        assert len(code) == 8

        lookup = client.get(f"/api/cloud/sessions/{code}")
        assert lookup.status_code == 200
        assert lookup.json()["team_name"] == "LMU Team"

        ticket = client.post(
            f"/api/cloud/sessions/{code}/ticket",
            json={"display_name": "Engineer", "role": "viewer"},
        )
        assert ticket.status_code == 200
        assert ticket.json()["ticket"]


def test_live_relay(monkeypatch):
    monkeypatch.setenv("TEAM_ADMIN_KEY", "test-secret")
    with TestClient(app) as client:
        code = client.post(
            "/api/cloud/sessions",
            headers={"X-Team-Admin-Key": "test-secret"},
            json={"name": "Relay Test", "team_name": "LMU Team"},
        ).json()["code"]
        publisher_ticket = client.post(
            f"/api/cloud/sessions/{code}/ticket",
            json={"display_name": "Driver One", "role": "publisher"},
        ).json()["ticket"]
        viewer_ticket = client.post(
            f"/api/cloud/sessions/{code}/ticket",
            json={"display_name": "Engineer", "role": "viewer"},
        ).json()["ticket"]
        with client.websocket_connect(f"/ws/cloud/{code}?ticket={publisher_ticket}") as publisher:
            with client.websocket_connect(f"/ws/cloud/{code}?ticket={viewer_ticket}") as viewer:
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
        code = client.post(
            "/api/cloud/sessions",
            headers={"X-Team-Admin-Key": "test-secret"},
            json={"name": "Lap Test", "team_name": "LMU Team"},
        ).json()["code"]
        ticket = client.post(
            f"/api/cloud/sessions/{code}/ticket",
            json={"display_name": "Driver Two", "role": "publisher"},
        ).json()["ticket"]
        with client.websocket_connect(f"/ws/cloud/{code}?ticket={ticket}") as publisher:
            publisher.send_json({"kind": "snapshot", "payload": {"telemetry": {"player": {"lap_number": 1, "fuel_liters": 50.0, "speed_kph": 200.0}}}})
            publisher.send_json({"kind": "snapshot", "payload": {"telemetry": {"player": {"lap_number": 1, "fuel_liters": 48.0, "speed_kph": 260.0}}}})
            publisher.send_json({"kind": "snapshot", "payload": {"telemetry": {"player": {"lap_number": 2, "last_lap_time": 215.4, "fuel_liters": 47.9, "speed_kph": 180.0}}}})
        laps = client.get(f"/api/cloud/sessions/{code}/laps")
        assert laps.status_code == 200
        assert laps.json()[-1]["driver_name"] == "Driver Two"
        assert laps.json()[-1]["lap_number"] == 1
        assert laps.json()[-1]["fuel_used"] == 2.0
