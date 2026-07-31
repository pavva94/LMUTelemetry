import ssl

from app.services.team_sharing_service import TeamSharingService


def test_cloud_websocket_uses_verified_packaged_ca_bundle():
    context = TeamSharingService._ssl_context()

    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is True
    assert context.cert_store_stats()["x509_ca"] > 0
