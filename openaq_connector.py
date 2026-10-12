"""
AeroSys-Delhi: OpenAQ API v3 Connector
Integrates official OpenAQ v3 REST API (https://api.openaq.org/v3/)
Provides monitoring locations, coordinates, and real-time sensors for Delhi NCR.

Note on OpenAQ API v3:
1. Base URL is https://api.openaq.org/v3/ (not https://openaq.org).
2. Point-and-radius uses 'coordinates' ("latitude,longitude") and 'radius' (in meters, max 25000).
3. Requires an API key in the 'X-API-Key' header (free registration at https://explore.openaq.org/register).
"""

import os
import ssl
import json
import urllib.request
import urllib.parse
import urllib.error
from typing import Dict, Any, Optional, List

class OpenAQConnector:
    """
    Connects to OpenAQ v3 API for ground-level air quality observations.
    """
    BASE_URL = "https://api.openaq.org/v3"

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("OPENAQ_API_KEY", "").strip()
        try:
            self.ssl_ctx = ssl._create_unverified_context()
        except Exception:
            self.ssl_ctx = None

    def fetch_delhi_locations(
        self,
        latitude: float = 28.6139,
        longitude: float = 77.2090,
        radius_m: int = 25000,
        limit: int = 6
    ) -> Dict[str, Any]:
        """
        Fetches monitoring stations in Delhi NCR within a specified radius.
        Uses OpenAQ v3: /v3/locations?coordinates={lat},{lon}&radius={radius}&limit={limit}
        """
        # Ensure radius does not exceed OpenAQ v3 limit (25,000 meters)
        radius_m = min(radius_m, 25000)

        # OpenAQ v3 coordinates are formatted as "latitude,longitude"
        params = {
            "coordinates": f"{latitude:.4f},{longitude:.4f}",
            "radius": str(radius_m),
            "limit": str(limit)
        }
        query_string = urllib.parse.urlencode(params)
        endpoint = f"{self.BASE_URL}/locations?{query_string}"

        if not self.api_key or self.api_key == "YOUR_OPENAQ_API_KEY":
            return {
                "status": "API_KEY_REQUIRED",
                "is_live_api": False,
                "api_provider": "OpenAQ API v3 (Global Air Quality Data Platform)",
                "error": "Authentication required. OpenAQ API v3 requires a valid API key in the X-API-Key header.",
                "action_required": "Get a free OpenAQ v3 API key at https://explore.openaq.org/register and pass it via header or OPENAQ_API_KEY environment variable.",
                "correct_endpoint": endpoint,
                "sample_code_snippet": {
                    "url": "https://api.openaq.org/v3/locations",
                    "params": {
                        "coordinates": f"{latitude:.4f},{longitude:.4f}",
                        "radius": radius_m,
                        "limit": limit
                    },
                    "headers": {
                        "X-API-Key": "<YOUR_ACTUAL_OPENAQ_API_KEY>"
                    }
                }
            }

        headers = {
            "X-API-Key": self.api_key,
            "User-Agent": "AeroSys-Delhi-AirQuality/2.4",
            "Accept": "application/json"
        }

        try:
            req = urllib.request.Request(endpoint, headers=headers)
            with urllib.request.urlopen(req, context=self.ssl_ctx, timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            results = data.get("results", [])
            formatted_locations = []

            for loc in results:
                formatted_locations.append({
                    "id": loc.get("id"),
                    "name": loc.get("name"),
                    "locality": loc.get("locality"),
                    "coordinates": loc.get("coordinates", {}),
                    "sensors_count": len(loc.get("sensors", [])),
                    "sensors": [
                        {
                            "id": s.get("id"),
                            "name": s.get("name"),
                            "parameter": s.get("parameter", {}).get("name"),
                            "units": s.get("parameter", {}).get("units")
                        }
                        for s in loc.get("sensors", [])
                    ],
                    "datetime_last": loc.get("datetimeLast", {}).get("utc")
                })

            return {
                "status": "SUCCESS",
                "is_live_api": True,
                "api_provider": "OpenAQ API v3",
                "endpoint": endpoint,
                "count": len(formatted_locations),
                "total_found": data.get("meta", {}).get("found", len(formatted_locations)),
                "locations": formatted_locations
            }

        except urllib.error.HTTPError as http_err:
            error_body = ""
            try:
                error_body = http_err.read().decode("utf-8")
            except Exception:
                pass
            return {
                "status": "HTTP_ERROR",
                "is_live_api": False,
                "http_code": http_err.code,
                "error": str(http_err),
                "detail": error_body,
                "endpoint_called": endpoint
            }
        except Exception as e:
            return {
                "status": "NETWORK_ERROR",
                "is_live_api": False,
                "error": str(e),
                "endpoint_called": endpoint
            }

    def fetch_location_latest(self, location_id: int) -> Dict[str, Any]:
        """
        Fetches latest sensor measurements for a specific OpenAQ location.
        Endpoint: /v3/locations/{location_id}/latest
        """
        if not self.api_key or self.api_key == "YOUR_OPENAQ_API_KEY":
            return {
                "status": "API_KEY_REQUIRED",
                "error": "Valid OpenAQ v3 API key required."
            }

        endpoint = f"{self.BASE_URL}/locations/{location_id}/latest"
        headers = {
            "X-API-Key": self.api_key,
            "User-Agent": "AeroSys-Delhi-AirQuality/2.4",
            "Accept": "application/json"
        }

        try:
            req = urllib.request.Request(endpoint, headers=headers)
            with urllib.request.urlopen(req, context=self.ssl_ctx, timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return {
                "status": "SUCCESS",
                "location_id": location_id,
                "results": data.get("results", [])
            }
        except Exception as e:
            return {
                "status": "ERROR",
                "location_id": location_id,
                "error": str(e)
            }
