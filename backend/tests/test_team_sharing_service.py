import ssl

from app.telemetry.mock_collector import MockTelemetryCollector

from app.services.team_sharing_service import TeamSharingService


def test_cloud_websocket_uses_verified_packaged_ca_bundle():
    context = TeamSharingService._ssl_context()

    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is True
    assert context.cert_store_stats()["x509_ca"] > 0


def test_team_frame_fits_cloud_limit_and_contains_live_telemetry():
    class TelemetryService:
        latest_snapshot = MockTelemetryCollector().poll_once()
        strategy_state = None
        recommendation_payload = None

    frame = TeamSharingService(TelemetryService())._frame()

    assert frame is not None
    assert len(frame.encode("utf-8")) < 32_768
    assert '"connected":true' in frame
