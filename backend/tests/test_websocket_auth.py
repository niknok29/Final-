import time
import uuid

import jwt
import pytest
from starlette.websockets import WebSocketDisconnect

from app import auth, realtime


def make_token(role="dispatcher", exp_in=3600):
    t = int(time.time())
    claims = {"sub": "t", "role": role, "iat": t - 5, "exp": t + exp_in, "iss": auth.ISSUER, "aud": auth.AUDIENCE}
    return jwt.encode(claims, auth.SECRET, algorithm="HS256")


def assert_closed_1008(client, url):
    """The socket is accepted and then closed with 1008 (browsers see 1008, not 1006), and never registered."""
    with client.websocket_connect(url) as ws:
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_text()
    assert e.value.code == 1008
    assert not realtime.hub.dispatchers and not realtime.hub.citizens


@pytest.mark.parametrize("token", ["", "garbage", make_token(exp_in=-10), make_token(role="viewer")],
                         ids=["missing", "invalid", "expired", "wrong-role"])
def test_dispatcher_ws_rejected_with_1008(client, token):
    assert_closed_1008(client, f"/ws/dispatcher?token={token}")


@pytest.mark.parametrize("cid", ["", "not-a-uuid"], ids=["missing", "invalid"])
def test_citizen_ws_rejected_with_1008(client, cid):
    assert_closed_1008(client, f"/ws/citizen?citizenId={cid}")


def test_valid_connections_are_still_accepted(client, headers):
    with client.websocket_connect("/ws/dispatcher?token=" + make_token("admin")):
        assert len(realtime.hub.dispatchers) == 1
    with client.websocket_connect(f"/ws/citizen?citizenId={uuid.uuid4()}"):
        assert len(realtime.hub.citizens) == 1
