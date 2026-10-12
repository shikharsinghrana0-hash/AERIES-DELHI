"""
AeroSys-Delhi: Satellite Feeds Ingestion Pipeline
Simulates ingest of:
1. NASA VIIRS (Suomi-NPP / NOAA-20) 375m Active Fire Detection.
2. MODIS (Terra / Aqua) Thermal Anomalies and FRP.
3. Sentinel-5P TROPOMI Tropospheric NO2 Column & Aerosol Index.
"""

import time
import math
try:
    from scientific_engine.plume_dispersion_model import PlumeDispersionEngine
except (ImportError, ValueError):
    from backend.scientific_engine.plume_dispersion_model import PlumeDispersionEngine

class SatelliteFeedsPipeline:
    """
    Ingests and processes Earth Observation satellite data covering the Indo-Gangetic Plain.
    """
    def __init__(self):
        self.plume_engine = PlumeDispersionEngine()

    def get_active_satellite_overpasses(self) -> List[Dict[str, Any]]:
        """
        Returns telemetry of satellite sensors currently observing the Delhi-Punjab-Haryana corridor.
        """
        return [
            {
                "satellite": "Suomi-NPP",
                "instrument": "VIIRS (Visible Infrared Imaging Radiometer Suite)",
                "orbit_type": "Sun-Synchronous (Polar)",
                "resolution": "375m I-Band Thermal",
                "last_overpass_utc": "10:45 UTC",
                "status": "OPERATIONAL / INGESTING",
                "active_detections_punjab_haryana": 1842
            },
            {
                "satellite": "NOAA-20 (JPSS-1)",
                "instrument": "VIIRS",
                "orbit_type": "Sun-Synchronous (Polar)",
                "resolution": "375m I-Band Thermal",
                "last_overpass_utc": "11:35 UTC",
                "status": "OPERATIONAL / INGESTING",
                "active_detections_punjab_haryana": 1928
            },
            {
                "satellite": "Aqua (EOS PM-1)",
                "instrument": "MODIS (Moderate Resolution Imaging Spectroradiometer)",
                "orbit_type": "Sun-Synchronous (Polar)",
                "resolution": "1000m Thermal Channels 21/22 & 31",
                "last_overpass_utc": "10:15 UTC",
                "status": "OPERATIONAL / INGESTING",
                "active_detections_punjab_haryana": 1410
            },
            {
                "satellite": "Sentinel-5P (Copernicus)",
                "instrument": "TROPOMI (Tropospheric Monitoring Instrument)",
                "orbit_type": "Sun-Synchronous",
                "resolution": "3.5 x 5.5 km",
                "last_overpass_utc": "08:20 UTC",
                "status": "OPERATIONAL / INGESTING",
                "mean_tropospheric_no2_umol_m2": 242.6,
                "uv_aerosol_index": 3.84
            }
        ]

    def get_consolidated_fire_intelligence(self, hour: float = 0.0, intensity_mult: float = 1.0) -> Dict[str, Any]:
        """
        Returns aggregated regional biomass fire metrics across Punjab and Haryana.
        """
        hotspots = self.plume_engine.get_fire_hotspots(hour, intensity_mult)
        total_frp = sum(h["frp_mw"] for h in hotspots)
        total_emission_rate = sum(h["emission_rate_kgs"] for h in hotspots)
        total_acres = sum(h["acres_burning"] for h in hotspots)
        
        punjab_frp = sum(h["frp_mw"] for h in hotspots if h["state"] == "Punjab")
        haryana_frp = sum(h["frp_mw"] for h in hotspots if h["state"] == "Haryana")
        
        return {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "airshed_region": "Punjab-Haryana Agricultural Basin",
            "active_hotspot_clusters": len(hotspots),
            "total_frp_megawatts": round(total_frp, 1),
            "total_pm25_emission_flux_kgs": round(total_emission_rate, 2),
            "total_pm25_emission_flux_tonnes_per_day": round(total_emission_rate * 86.4, 1),
            "estimated_active_burning_acres": total_acres,
            "punjab_share_percent": round((punjab_frp / max(1.0, total_frp)) * 100.0, 1),
            "haryana_share_percent": round((haryana_frp / max(1.0, total_frp)) * 100.0, 1),
            "prevailing_transport_corridor": "North-Westerly Advection -> Delhi NCR Bowl",
            "hotspots": hotspots,
            "satellite_sensors": self.get_active_satellite_overpasses()
        }
