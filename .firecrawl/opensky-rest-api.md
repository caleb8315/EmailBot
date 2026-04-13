[The OpenSky Network API\\
![Logo](https://openskynetwork.github.io/opensky-api/_static/radar_small.png)](https://openskynetwork.github.io/opensky-api/index.html)

- [Intro & Data Structures](https://openskynetwork.github.io/opensky-api/index.html)
- [REST API](https://openskynetwork.github.io/opensky-api/rest.html#)
  - [All State Vectors](https://openskynetwork.github.io/opensky-api/rest.html#all-state-vectors)
    - [Operation](https://openskynetwork.github.io/opensky-api/rest.html#operation)
    - [Request](https://openskynetwork.github.io/opensky-api/rest.html#request)
    - [Response](https://openskynetwork.github.io/opensky-api/rest.html#response)
    - [Authentication](https://openskynetwork.github.io/opensky-api/rest.html#authentication)
      - [Python Token Manager Example](https://openskynetwork.github.io/opensky-api/rest.html#python-token-manager-example)
    - [Limitations](https://openskynetwork.github.io/opensky-api/rest.html#limitations)
    - [API Credits](https://openskynetwork.github.io/opensky-api/rest.html#api-credits)
    - [Examples](https://openskynetwork.github.io/opensky-api/rest.html#examples)
  - [Own State Vectors](https://openskynetwork.github.io/opensky-api/rest.html#own-state-vectors)
    - [Operation](https://openskynetwork.github.io/opensky-api/rest.html#id2)
    - [Request](https://openskynetwork.github.io/opensky-api/rest.html#id3)
    - [Response](https://openskynetwork.github.io/opensky-api/rest.html#id4)
    - [Examples](https://openskynetwork.github.io/opensky-api/rest.html#id5)
  - [Flights in Time Interval](https://openskynetwork.github.io/opensky-api/rest.html#flights-in-time-interval)
    - [Operation](https://openskynetwork.github.io/opensky-api/rest.html#id6)
    - [Request](https://openskynetwork.github.io/opensky-api/rest.html#id7)
    - [Response](https://openskynetwork.github.io/opensky-api/rest.html#id8)
    - [Examples](https://openskynetwork.github.io/opensky-api/rest.html#id9)
  - [Flights by Aircraft](https://openskynetwork.github.io/opensky-api/rest.html#flights-by-aircraft)
    - [Operation](https://openskynetwork.github.io/opensky-api/rest.html#id10)
    - [Request](https://openskynetwork.github.io/opensky-api/rest.html#id11)
    - [Response](https://openskynetwork.github.io/opensky-api/rest.html#id12)
    - [Examples](https://openskynetwork.github.io/opensky-api/rest.html#id13)
  - [Arrivals by Airport](https://openskynetwork.github.io/opensky-api/rest.html#arrivals-by-airport)
    - [Operation](https://openskynetwork.github.io/opensky-api/rest.html#id14)
    - [Request](https://openskynetwork.github.io/opensky-api/rest.html#id15)
    - [Response](https://openskynetwork.github.io/opensky-api/rest.html#id16)
    - [Examples](https://openskynetwork.github.io/opensky-api/rest.html#id17)
  - [Departures by Airport](https://openskynetwork.github.io/opensky-api/rest.html#departures-by-airport)
    - [Operation](https://openskynetwork.github.io/opensky-api/rest.html#id18)
    - [Request](https://openskynetwork.github.io/opensky-api/rest.html#id19)
    - [Response](https://openskynetwork.github.io/opensky-api/rest.html#id20)
    - [Examples](https://openskynetwork.github.io/opensky-api/rest.html#id21)
  - [Track by Aircraft](https://openskynetwork.github.io/opensky-api/rest.html#track-by-aircraft)
    - [Operation](https://openskynetwork.github.io/opensky-api/rest.html#id22)
    - [Request](https://openskynetwork.github.io/opensky-api/rest.html#id23)
    - [Response](https://openskynetwork.github.io/opensky-api/rest.html#id24)
    - [Limitations](https://openskynetwork.github.io/opensky-api/rest.html#id25)
    - [Examples](https://openskynetwork.github.io/opensky-api/rest.html#id26)
- [Trino Client](https://openskynetwork.github.io/opensky-api/trino.html)
- [Python API](https://openskynetwork.github.io/opensky-api/python.html)
- [Java API](https://openskynetwork.github.io/opensky-api/java.html)

[The OpenSky Network API](https://openskynetwork.github.io/opensky-api/index.html)

- [Home](https://openskynetwork.github.io/opensky-api/index.html)
- OpenSky REST API

* * *

# OpenSky REST API [¶](https://openskynetwork.github.io/opensky-api/rest.html\#opensky-rest-api "Link to this heading")

The root URL of our REST API is:

```
https://opensky-network.org/api
```

There are several functions available to retrieve [state vectors](https://openskynetwork.github.io/opensky-api/index.html#state-vectors), flights and tracks for the whole network, a particular sensor, or a particular aircraft. Note that the functions to retrieve state vectors of sensors other than your own are rate limited (see [Limitations](https://openskynetwork.github.io/opensky-api/rest.html#limitations)).

## All State Vectors [¶](https://openskynetwork.github.io/opensky-api/rest.html\#all-state-vectors "Link to this heading")

The following API call can be used to retrieve any state vector of the OpenSky. Please note that rate limits apply for this call (see [Limitations](https://openskynetwork.github.io/opensky-api/rest.html#limitations)). For API calls without rate limitation, see [Own State Vectors](https://openskynetwork.github.io/opensky-api/rest.html#own-states).

### Operation [¶](https://openskynetwork.github.io/opensky-api/rest.html\#operation "Link to this heading")

`GET /states/all`

### Request [¶](https://openskynetwork.github.io/opensky-api/rest.html\#request "Link to this heading")

You can (optionally) request state vectors for particular airplanes or times using the following request parameters:

| Property | Type | Description |
| --- | --- | --- |
| _time_ | integer | The time in seconds since epoch (Unix time<br>stamp to retrieve states for. Current time<br>will be used if omitted. |
| _icao24_ | string | One or more ICAO24 transponder addresses<br>represented by a hex string (e.g. abc9f3).<br>To filter multiple ICAO24 append the property<br>once for each address. If omitted, the state<br>vectors of all aircraft are returned. |

In addition to that, it is possible to query a certain area defined by a bounding box of WGS84 coordinates.
For this purpose, add all of the following parameters:

| Property | Type | Description |
| --- | --- | --- |
| _lamin_ | float | lower bound for the latitude in decimal degrees |
| _lomin_ | float | lower bound for the longitude in decimal degrees |
| _lamax_ | float | upper bound for the latitude in decimal degrees |
| _lomax_ | float | upper bound for the longitude in decimal degrees |

Lastly, you can request the category of aircraft by adding the following request parameter:

| Property | Type | Description |
| --- | --- | --- |
| _extended_ | integer | Set to 1 if required |

Example query with time and aircraft: `https://opensky-network.org/api/states/all?time=1458564121&icao24=3c6444`

Example query with bounding box covering Switzerland: `https://opensky-network.org/api/states/all?lamin=45.8389&lomin=5.9962&lamax=47.8229&lomax=10.5226`

### Response [¶](https://openskynetwork.github.io/opensky-api/rest.html\#response "Link to this heading")

The response is a JSON object with the following properties

| Property | Type | Description |
| --- | --- | --- |
| _time_ | integer | The time which the state vectors in this response are associated with.<br>All vectors represent the state of a vehicle with the interval<br>\[𝑡⁢𝑖⁢𝑚⁢𝑒−1,𝑡⁢𝑖⁢𝑚⁢𝑒\]. |
| _states_ | array | The state vectors. |

The _states_ property is a two-dimensional array. Each row represents a [state vector](https://openskynetwork.github.io/opensky-api/index.html#state-vectors)
and contains the following fields:

| Index | Property | Type | Description |
| --- | --- | --- | --- |
| 0 | _icao24_ | string | Unique ICAO 24-bit address of the transponder in hex string<br>representation. |
| 1 | _callsign_ | string | Callsign of the vehicle (8 chars). Can be null if no callsign<br>has been received. |
| 2 | _origin\_country_ | string | Country name inferred from the ICAO 24-bit address. |
| 3 | _time\_position_ | int | Unix timestamp (seconds) for the last position update. Can be<br>null if no position report was received by OpenSky within the<br>past 15s. |
| 4 | _last\_contact_ | int | Unix timestamp (seconds) for the last update in general. This<br>field is updated for any new, valid message received from the<br>transponder. |
| 5 | _longitude_ | float | WGS-84 longitude in decimal degrees. Can be null. |
| 6 | _latitude_ | float | WGS-84 latitude in decimal degrees. Can be null. |
| 7 | _baro\_altitude_ | float | Barometric altitude in meters. Can be null. |
| 8 | _on\_ground_ | boolean | Boolean value which indicates if the position was retrieved from<br>a surface position report. |
| 9 | _velocity_ | float | Velocity over ground in m/s. Can be null. |
| 10 | _true\_track_ | float | True track in decimal degrees clockwise from north (north=0°).<br>Can be null. |
| 11 | _vertical\_rate_ | float | Vertical rate in m/s. A positive value indicates that the<br>airplane is climbing, a negative value indicates that it<br>descends. Can be null. |
| 12 | _sensors_ | int\[\] | IDs of the receivers which contributed to this state vector.<br>Is null if no filtering for sensor was used in the request. |
| 13 | _geo\_altitude_ | float | Geometric altitude in meters. Can be null. |
| 14 | _squawk_ | string | The transponder code aka Squawk. Can be null. |
| 15 | _spi_ | boolean | Whether flight status indicates special purpose indicator. |
| 16 | _position\_source_ | int | Origin of this state’s position.<br>- 0 = ADS-B<br>  <br>- 1 = ASTERIX<br>  <br>- 2 = MLAT<br>  <br>- 3 = FLARM |
| 17 | _category_ | int | Aircraft category.<br>- 0 = No information at all<br>  <br>- 1 = No ADS-B Emitter Category Information<br>  <br>- 2 = Light (< 15500 lbs)<br>  <br>- 3 = Small (15500 to 75000 lbs)<br>  <br>- 4 = Large (75000 to 300000 lbs)<br>  <br>- 5 = High Vortex Large (aircraft such as B-757)<br>  <br>- 6 = Heavy (> 300000 lbs)<br>  <br>- 7 = High Performance (> 5g acceleration and 400 kts)<br>  <br>- 8 = Rotorcraft<br>  <br>- 9 = Glider / sailplane<br>  <br>- 10 = Lighter-than-air<br>  <br>- 11 = Parachutist / Skydiver<br>  <br>- 12 = Ultralight / hang-glider / paraglider<br>  <br>- 13 = Reserved<br>  <br>- 14 = Unmanned Aerial Vehicle<br>  <br>- 15 = Space / Trans-atmospheric vehicle<br>  <br>- 16 = Surface Vehicle – Emergency Vehicle<br>  <br>- 17 = Surface Vehicle – Service Vehicle<br>  <br>- 18 = Point Obstacle (includes tethered balloons)<br>  <br>- 19 = Cluster Obstacle<br>  <br>- 20 = Line Obstacle |

### Authentication [¶](https://openskynetwork.github.io/opensky-api/rest.html\#authentication "Link to this heading")

OpenSky exclusively supports the OAuth2 _client credentials_ flow. Basic authentication with username and password is no longer accepted.

To get started:

1. Log in to your OpenSky account and visit the [Account](https://opensky-network.org/my-opensky/account) page.

2. Create a new API client and retrieve your `client_id` and `client_secret`.

3. Exchange these for an access token, then pass it as a `Bearer` token on every request.


```
export CLIENT_ID=your_client_id
export CLIENT_SECRET=your_client_secret

export TOKEN=$(curl -X POST "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" | jq -r .access_token)

curl -H "Authorization: Bearer $TOKEN" https://opensky-network.org/api/states/all | jq .
```

Tokens expire after 30 minutes. A `401 Unauthorized` response means the token has expired - request a new one and retry.

#### Python Token Manager Example [¶](https://openskynetwork.github.io/opensky-api/rest.html\#python-token-manager-example "Link to this heading")

For scripts making multiple calls, use this `TokenManager` class to handle token refresh automatically:

```
import requests
from datetime import datetime, timedelta

TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
CLIENT_ID = "your_client_id"
CLIENT_SECRET = "your_client_secret"

# How many seconds before expiry to proactively refresh the token.
TOKEN_REFRESH_MARGIN = 30

class TokenManager:
    def __init__(self):
        self.token = None
        self.expires_at = None

    def get_token(self):
        """Return a valid access token, refreshing automatically if needed."""
        if self.token and self.expires_at and datetime.now() < self.expires_at:
            return self.token
        return self._refresh()

    def _refresh(self):
        """Fetch a new access token from the OpenSky authentication server."""
        r = requests.post(
            TOKEN_URL,
            data={
                "grant_type": "client_credentials",
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
            },
        )
        r.raise_for_status()

        data = r.json()
        self.token = data["access_token"]
        expires_in = data.get("expires_in", 1800)
        self.expires_at = datetime.now() + timedelta(seconds=expires_in - TOKEN_REFRESH_MARGIN)
        return self.token

    def headers(self):
        """Return request headers with a valid Bearer token."""
        return {"Authorization": f"Bearer {self.get_token()}"}

# Create a single shared instance for your script.
tokens = TokenManager()

# Use it for any API call - the token is refreshed automatically.
response = requests.get(
    "https://opensky-network.org/api/states/all",
    headers=tokens.headers(),
)
print(response.json())
```

- `get_token()` only fetches a new token when the current one is about to expire.

- `headers()` can be passed directly to any `requests` call.

- Create **one**`TokenManager` instance and reuse it for all requests in your script.


### Limitations [¶](https://openskynetwork.github.io/opensky-api/rest.html\#limitations "Link to this heading")

**Anonymous users** (unauthenticated, bucketed by IP):

- Only the most recent state vectors are available - the `time` parameter is ignored.

- Time resolution is 10 seconds: 𝑛⁢𝑜⁢𝑤−(𝑛⁢𝑜⁢𝑤⁢⁢mod⁡⁢10).


**Authenticated users:**

- State vectors up to 1 hour in the past. Requests with 𝑡<𝑛⁢𝑜⁢𝑤−3600 return `400 Bad Request`.

- Time resolution is 5 seconds: 𝑡−(𝑡⁢⁢mod⁡⁢5).


Note

You can retrieve state vectors from your own receivers without any credit cost or time restriction. See [Own State Vectors](https://openskynetwork.github.io/opensky-api/rest.html#own-states).

### API Credits [¶](https://openskynetwork.github.io/opensky-api/rest.html\#api-credits "Link to this heading")

All endpoints consume credits except `/states/own`. Credits are tracked in **three independent buckets** \- one each for `/states/*`, `/tracks/*`, and `/flights/*`. Spending credits on one endpoint has no effect on the others.

**Credit quotas by tier - per endpoint (states, tracks, and flights each have their own independent quota):**

| Tier | Credits | Refill |
| --- | --- | --- |
| Anonymous | 400 | Daily |
| Standard user | 4,000 | Daily |
| Active feeder<br>(≥30% uptime/month) | 8,000 | Daily |
| Licensed user | 14,400 | Hourly |

Note

Active feeder status is recalculated every 2 hours. Tier upgrades take effect after ~50 requests. To confirm you are receiving the 8,000-credit allowance, check that `X-Rate-Limit-Remaining` exceeds 4,000 at the start of a day.

**Credit cost - \`\`/states/all\`\`** (bounding box area in sq° = latitude range × longitude range):

| Bounding box area | Credits |
| --- | --- |
| ≤ 25 sq° or<br>serial-only query | 1 |
| 25 – 100 sq° | 2 |
| 100 – 400 sq° | 3 |
| \> 400 sq° or global | 4 |

**Credit cost - \`\`/flights/\*\`\` and \`\`/tracks/\*\`\`** (by day partitions - calendar day boundaries crossed by the time range):

| Partitions | Credits |
| --- | --- |
| Live / < 24 h | 4 |
| 1 – 2 | 30 |
| 3 – 10 | 60 × N |
| 11 – 15 | 120 × N |
| 16 – 20 | 240 × N |
| 21 – 25 | 480 × N |
| \> 25 | 960 × N |

When credits are available, `X-Rate-Limit-Remaining` shows your remaining balance. When exhausted, the API returns `429 Too Many Requests` and `X-Rate-Limit-Retry-After-Seconds` indicates how many seconds to wait.

### Examples [¶](https://openskynetwork.github.io/opensky-api/rest.html\#examples "Link to this heading")

Retrieve all states as an anonymous user:

```
$ curl -s "https://opensky-network.org/api/states/all" | python -m json.tool
```

Retrieve all states as an authenticated OpenSky user:

```
$ curl -H "Authorization: Bearer $TOKEN" -s "https://opensky-network.org/api/states/all" | python -m json.tool
```

Retrieve states of two particular airplanes:

```
$ curl -s "https://opensky-network.org/api/states/all?icao24=3c6444&icao24=3e1bf9" | python -m json.tool
```

* * *

## Own State Vectors [¶](https://openskynetwork.github.io/opensky-api/rest.html\#own-state-vectors "Link to this heading")

The following API call can be used to retrieve state vectors for your own sensors without rate limitations.
Note that authentication is required for this operation, otherwise you will get a 403 - Forbidden.

### Operation [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id2 "Link to this heading")

`GET /states/own`

### Request [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id3 "Link to this heading")

Pass one of the following (optional) properties as request parameters to the GET request.

| Property | Type | Description |
| --- | --- | --- |
| _time_ | integer | The time in seconds since epoch (Unix<br>timestamp to retrieve states for. Current time<br>will be used if omitted. |
| _icao24_ | string | One or more ICAO24 transponder addresses<br>represented by a hex string (e.g. abc9f3).<br>To filter multiple ICAO24 append the property<br>once for each address. If omitted, the state<br>vectors of all aircraft are returned. |
| _serials_ | integer | Retrieve only states of a subset of your<br>receivers. You can pass this argument several<br>time to filter state of more than one of your<br>receivers. In this case, the API returns all<br>states of aircraft that are visible to at<br>least one of the given receivers. |

### Response [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id4 "Link to this heading")

The response is a JSON object with the following properties

| Property | Type | Description |
| --- | --- | --- |
| _time_ | integer | The time which the state vectors in this response are associated with.<br>All vectors represent the state of a vehicle with the interval<br>\[𝑡⁢𝑖⁢𝑚⁢𝑒−1,𝑡⁢𝑖⁢𝑚⁢𝑒\]. |
| _states_ | array | The state vectors. |

The _states_ property is a two-dimensional array. Each row represents a [state vector](https://openskynetwork.github.io/opensky-api/index.html#state-vectors)
and contains the following fields:

| Index | Property | Type | Description |
| --- | --- | --- | --- |
| 0 | _icao24_ | string | Unique ICAO 24-bit address of the transponder in hex string<br>representation. |
| 1 | _callsign_ | string | Callsign of the vehicle (8 chars). Can be null if no callsign<br>has been received. |
| 2 | _origin\_country_ | string | Country name inferred from the ICAO 24-bit address. |
| 3 | _time\_position_ | int | Unix timestamp (seconds) for the last position update. Can be<br>null if no position report was received by OpenSky within the<br>past 15s. |
| 4 | _last\_contact_ | int | Unix timestamp (seconds) for the last update in general. This<br>field is updated for any new, valid message received from the<br>transponder. |
| 5 | _longitude_ | float | WGS-84 longitude in decimal degrees. Can be null. |
| 6 | _latitude_ | float | WGS-84 latitude in decimal degrees. Can be null. |
| 7 | _baro\_altitude_ | float | Barometric altitude in meters. Can be null. |
| 8 | _on\_ground_ | boolean | Boolean value which indicates if the position was retrieved from<br>a surface position report. |
| 9 | _velocity_ | float | Velocity over ground in m/s. Can be null. |
| 10 | _true\_track_ | float | True track in decimal degrees clockwise from north (north=0°).<br>Can be null. |
| 11 | _vertical\_rate_ | float | Vertical rate in m/s. A positive value indicates that the<br>airplane is climbing, a negative value indicates that it<br>descends. Can be null. |
| 12 | _sensors_ | int\[\] | IDs of the receivers which contributed to this state vector.<br>Is null if no filtering for sensor was used in the request. |
| 13 | _geo\_altitude_ | float | Geometric altitude in meters. Can be null. |
| 14 | _squawk_ | string | The transponder code aka Squawk. Can be null. |
| 15 | _spi_ | boolean | Whether flight status indicates special purpose indicator. |
| 16 | _position\_source_ | int | Origin of this state’s position.<br>- 0 = ADS-B<br>  <br>- 1 = ASTERIX<br>  <br>- 2 = MLAT<br>  <br>- 3 = FLARM |
| 17 | _category_ | int | Aircraft category.<br>- 0 = No information at all<br>  <br>- 1 = No ADS-B Emitter Category Information<br>  <br>- 2 = Light (< 15500 lbs)<br>  <br>- 3 = Small (15500 to 75000 lbs)<br>  <br>- 4 = Large (75000 to 300000 lbs)<br>  <br>- 5 = High Vortex Large (aircraft such as B-757)<br>  <br>- 6 = Heavy (> 300000 lbs)<br>  <br>- 7 = High Performance (> 5g acceleration and 400 kts)<br>  <br>- 8 = Rotorcraft<br>  <br>- 9 = Glider / sailplane<br>  <br>- 10 = Lighter-than-air<br>  <br>- 11 = Parachutist / Skydiver<br>  <br>- 12 = Ultralight / hang-glider / paraglider<br>  <br>- 13 = Reserved<br>  <br>- 14 = Unmanned Aerial Vehicle<br>  <br>- 15 = Space / Trans-atmospheric vehicle<br>  <br>- 16 = Surface Vehicle – Emergency Vehicle<br>  <br>- 17 = Surface Vehicle – Service Vehicle<br>  <br>- 18 = Point Obstacle (includes tethered balloons)<br>  <br>- 19 = Cluster Obstacle<br>  <br>- 20 = Line Obstacle |

### Examples [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id5 "Link to this heading")

Retrieve states for all sensors that belong to you:

```
$ curl -H "Authorization: Bearer $TOKEN" -s "https://opensky-network.org/api/states/own" | python -m json.tool
```

Retrieve states as seen by a specific sensor with serial 123456

```
$ curl -H "Authorization: Bearer $TOKEN" -s "https://opensky-network.org/api/states/own?serials=123456" | python -m json.tool
```

Retrieve states for several receivers:

```
$ curl -H "Authorization: Bearer $TOKEN" -s "https://opensky-network.org/api/states/own?serials=123456&serials=98765" | python -m json.tool
```

## Flights in Time Interval [¶](https://openskynetwork.github.io/opensky-api/rest.html\#flights-in-time-interval "Link to this heading")

This API call retrieves flights for a certain time interval \[begin, end\]. If no flights
are found for the given time period, HTTP status 404 - Not found is returned with an empty
response body.

### Operation [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id6 "Link to this heading")

`GET /flights/all`

### Request [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id7 "Link to this heading")

These are the required request parameters:

| Property | Type | Description |
| --- | --- | --- |
| _begin_ | integer | Start of time interval to retrieve flights for<br>as Unix time (seconds since epoch) |
| _end_ | integer | End of time interval to retrieve flights for<br>as Unix time (seconds since epoch) |

The given time interval must not be larger than two hours!

### Response [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id8 "Link to this heading")

The response is a JSON array of flights where each flight is an object with the following properties:

### Examples [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id9 "Link to this heading")

Get flights from 12pm to 1pm on Jan 29 2018:

```
$ curl -H "Authorization: Bearer $TOKEN" -s "https://opensky-network.org/api/flights/all?begin=1517227200&end=1517230800" | python -m json.tool
```

## Flights by Aircraft [¶](https://openskynetwork.github.io/opensky-api/rest.html\#flights-by-aircraft "Link to this heading")

This API call retrieves flights for a particular aircraft within a certain time interval.
Resulting flights departed and arrived within \[begin, end\].
If no flights are found for the given period, HTTP stats 404 - Not found is returned with an
empty response body.

Note

Flights are updated by a batch process at night, i.e., only flights from the previous day or earlier are available using this endpoint.

### Operation [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id10 "Link to this heading")

`GET /flights/aircraft`

### Request [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id11 "Link to this heading")

These are the required request parameters:

| Property | Type | Description |
| --- | --- | --- |
| _icao24_ | string | Unique ICAO 24-bit address of the transponder<br>in hex string representation. All letters need<br>to be lower case |
| _begin_ | integer | Start of time interval to retrieve flights for<br>as Unix time (seconds since epoch) |
| _end_ | integer | End of time interval to retrieve flights for<br>as Unix time (seconds since epoch) |

The given time interval must not be larger than 2 days!

### Response [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id12 "Link to this heading")

The response is a JSON array of flights where each flight is an object with the following properties:

### Examples [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id13 "Link to this heading")

Get flights for D-AIZZ (3c675a) on Jan 29 2018:

```
$ curl -H "Authorization: Bearer $TOKEN" -s "https://opensky-network.org/api/flights/aircraft?icao24=3c675a&begin=1517184000&end=1517270400" | python -m json.tool
```

## Arrivals by Airport [¶](https://openskynetwork.github.io/opensky-api/rest.html\#arrivals-by-airport "Link to this heading")

Retrieve flights for a certain airport which arrived within a given time interval \[begin, end\].
If no flights are found for the given period, HTTP stats 404 - Not found is returned with an
empty response body.

Note

Similar to flights, arrivals are updated by a batch process at night, i.e., only arrivals from the previous day or earlier are available using this endpoint.

### Operation [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id14 "Link to this heading")

`GET /flights/arrival`

### Request [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id15 "Link to this heading")

These are the required request parameters:

| Property | Type | Description |
| --- | --- | --- |
| _airport_ | string | ICAO identier for the airport |
| _begin_ | integer | Start of time interval to retrieve flights for<br>as Unix time (seconds since epoch) |
| _end_ | integer | End of time interval to retrieve flights for<br>as Unix time (seconds since epoch) |

The given time interval must not be larger than two days!

### Response [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id16 "Link to this heading")

The response is a JSON array of flights where each flight is an object with the following properties:

### Examples [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id17 "Link to this heading")

Get all flights arriving at Frankfurt International Airport (EDDF) from 12pm to 1pm on Jan 29 2018:

```
$ curl -H "Authorization: Bearer $TOKEN" -s "https://opensky-network.org/api/flights/arrival?airport=EDDF&begin=1517227200&end=1517230800" | python -m json.tool
```

## Departures by Airport [¶](https://openskynetwork.github.io/opensky-api/rest.html\#departures-by-airport "Link to this heading")

Retrieve flights for a certain airport which departed within a given time interval \[begin, end\].
If no flights are found for the given period, HTTP stats 404 - Not found is returned with an
empty response body.

### Operation [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id18 "Link to this heading")

`GET /flights/departure`

### Request [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id19 "Link to this heading")

These are the required request parameters:

| Property | Type | Description |
| --- | --- | --- |
| _airport_ | string | ICAO identier for the airport (usually upper<br>case) |
| _begin_ | integer | Start of time interval to retrieve flights for<br>as Unix time (seconds since epoch) |
| _end_ | integer | End of time interval to retrieve flights for<br>as Unix time (seconds since epoch) |

The given time interval must cover more than two days (UTC)!

### Response [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id20 "Link to this heading")

The response is a JSON array of flights where each flight is an object with the following properties

### Examples [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id21 "Link to this heading")

Get all flights departing at Frankfurt International Airport (EDDF) from 12pm to 1pm on Jan 29 2018:

```
$ curl -H "Authorization: Bearer $TOKEN" -s "https://opensky-network.org/api/flights/departure?airport=EDDF&begin=1517227200&end=1517230800" | python -m json.tool
```

## Track by Aircraft [¶](https://openskynetwork.github.io/opensky-api/rest.html\#track-by-aircraft "Link to this heading")

Note

The tracks endpoint is purely **experimental**. You can use the flights endpoint for historical data: [Flights in Time Interval](https://openskynetwork.github.io/opensky-api/rest.html#flights-all).

Retrieve the trajectory for a certain aircraft at a given time. The trajectory
is a list of waypoints containing position, barometric altitude, true track and
an on-ground flag.

In contrast to state vectors, trajectories do not contain all information we
have about the flight, but rather show the aircraft’s general movement
pattern. For this reason, waypoints are selected among available state
vectors given the following set of rules:

- The first point is set immediately after the the aircraft’s expected
departure, or after the network received the first position when the
aircraft entered its reception range.

- The last point is set right before the aircraft’s expected arrival, or the
aircraft left the networks reception range.

- There is a waypoint at least every 15 minutes when the aircraft is in-flight.

- A waypoint is added if the aircraft changes its track more than 2.5°.

- A waypoint is added if the aircraft changes altitude by more than 100m (~330ft).

- A waypoint is added if the on-ground state changes.


Tracks are strongly related to [flights](https://openskynetwork.github.io/opensky-api/rest.html#flights-all). Internally, we compute flights
and tracks within the same processing step. As such, it may be beneficial to
retrieve a list of flights with the API methods from above, and use these results
with the given time stamps to retrieve detailed track information.

### Operation [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id22 "Link to this heading")

`GET /tracks`

### Request [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id23 "Link to this heading")

| Property | Type | Description |
| --- | --- | --- |
| _icao24_ | string | Unique ICAO 24-bit address of the transponder<br>in hex string representation. All letters need<br>to be lower case |
| _time_ | integer | Unix time in seconds since epoch. It can be<br>any time between start and end of a known<br>flight. If time = 0, get the live track if<br>there is any flight ongoing for the given<br>aircraft. |

### Response [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id24 "Link to this heading")

This endpoint is experimental and can be out of order at any time.

The response is a JSON object with the following properties:

| Property | Type | Description |
| --- | --- | --- |
| _icao24_ | string | Unique ICAO 24-bit address of the transponder in lower case hex string<br>representation. |
| _startTime_ | integer | Time of the first waypoint in seconds since epoch (Unix time). |
| _endTime_ | integer | Time of the last waypoint in seconds since epoch (Unix time). |
| _calllsign_ | string | Callsign (8 characters) that holds for the whole track. Can be null. |
| _path_ | array | Waypoints of the trajectory (description below). |

Waypoints are represented as JSON arrays to save bandwidth. Each point contains the following
information:

| Index | Property | Type | Description |
| --- | --- | --- | --- |
| 0 | _time_ | integer | Time which the given waypoint is associated with in seconds since<br>epoch (Unix time). |
| 1 | _latitude_ | float | WGS-84 latitude in decimal degrees. Can be null. |
| 2 | _longitude_ | float | WGS-84 longitude in decimal degrees. Can be null. |
| 3 | _baro\_altitude_ | float | Barometric altitude in meters. Can be null. |
| 4 | _true\_track_ | float | True track in decimal degrees clockwise from north (north=0°).<br>Can be null. |
| 5 | _on\_ground_ | boolean | Boolean value which indicates if the position was retrieved from<br>a surface position report. |

### Limitations [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id25 "Link to this heading")

It is not possible to access flight tracks from more than 30 days in the past.

### Examples [¶](https://openskynetwork.github.io/opensky-api/rest.html\#id26 "Link to this heading")

Get the live track for aircraft with transponder address 3c4b26 (D-ABYF)

```
$ curl -H "Authorization: Bearer $TOKEN" -s "https://opensky-network.org/api/tracks/all?icao24=3c4b26&time=0"
```

See also

[Trino - Historical Data](https://openskynetwork.github.io/opensky-api/trino.html#trino) \- For historical data spanning more than one hour, use the Trino/MinIO interface instead of the REST API.

[Previous](https://openskynetwork.github.io/opensky-api/index.html "The OpenSky Network API documentation") [Next](https://openskynetwork.github.io/opensky-api/trino.html "Trino - Historical Data")

* * *

© Copyright 2021, The OpenSky Network.

Built with [Sphinx](https://www.sphinx-doc.org/) using a
[theme](https://github.com/readthedocs/sphinx_rtd_theme)
provided by [Read the Docs](https://readthedocs.org/).