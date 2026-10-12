"""
AeroSys-Delhi: Stubble Plume Dispersion & Transport Model
Implements:
1. Multi-source biomass burning emission flux parameterization from VIIRS/MODIS FRP.
2. Plume rise & thermal injection height calculation.
3. Lagrangian puff advection along synoptic North-Westerly wind corridors into Delhi NCR.
4. Capping inversion trapping and ground fumigation reflection.
"""

import math
import random
from typing import List, Dict, Any, Tuple

# Key agricultural stubble burning source clusters across Punjab and Haryana
REGIONAL_FIRE_CLUSTERS = [
    {"id": "PB-SGR", "name": "Sangrur Cluster", "state": "Punjab", "lat": 30.24, "lon": 75.84, "base_frp": 620.0, "acres_burning": 3400},
    {"id": "PB-BTI", "name": "Bathinda Cluster", "state": "Punjab", "lat": 30.21, "lon": 74.94, "base_frp": 540.0, "acres_burning": 2900},
    {"id": "PB-LDH", "name": "Ludhiana-Khanna Belt", "state": "Punjab", "lat": 30.90, "lon": 75.85, "base_frp": 480.0, "acres_burning": 2600},
    {"id": "PB-FZR", "name": "Firozpur-Moga Airshed", "state": "Punjab", "lat": 30.92, "lon": 74.62, "base_frp": 430.0, "acres_burning": 2400},
    {"id": "PB-TTN", "name": "Tarn Taran Border Corridor", "state": "Punjab", "lat": 31.45, "lon": 74.92, "base_frp": 510.0, "acres_burning": 2800},
    {"id": "HR-KTL", "name": "Kaithal Central", "state": "Haryana", "lat": 29.80, "lon": 76.40, "base_frp": 380.0, "acres_burning": 1900},
    {"id": "HR-KRN", "name": "Karnal-GT Road Axis", "state": "Haryana", "lat": 29.68, "lon": 76.98, "base_frp": 340.0, "acres_burning": 1700},
    {"id": "HR-JND", "name": "Jind Agricultural Belt", "state": "Haryana", "lat": 29.31, "lon": 76.31, "base_frp": 310.0, "acres_burning": 1500},
    {"id": "HR-FTB", "name": "Fatehabad West", "state": "Haryana", "lat": 29.51, "lon": 75.45, "base_frp": 360.0, "acres_burning": 1800}
]

# Delhi NCR receptor reference coordinate (Central Delhi)
DELHI_RECEPTOR = {"lat": 28.6139, "lon": 77.2090, "name": "Delhi NCR Airshed Hub"}

class PlumeDispersionEngine:
    """
    Simulates regional transport and fumigation of stubble fire plumes into Delhi NCR.
    """
    def __init__(self):
        # Emission conversion factor: ~0.022 kg PM2.5 per Megawatt of FRP per second
        self.frp_to_emission_rate = 0.022

    def calculate_plume_injection_height(self, frp_mw: float, pbl_height_m: float) -> float:
        """
        Computes effective thermal plume rise height (meters AGL) based on Fire Radiative Power.
        Strong fires punch higher into the atmosphere:
        z_plume = 110.0 * (FRP / 100)^0.33
        """
        plume_rise = 110.0 * ((max(10.0, frp_mw) / 100.0) ** 0.333)
        # Cap injection height to prevent unnatural stratosphere penetration
        effective_height = min(pbl_height_m * 1.3, max(80.0, plume_rise))
        return round(effective_height, 1)

    def get_fire_hotspots(self, hour: float, intensity_multiplier: float = 1.0) -> List[Dict[str, Any]]:
        """
        Returns active satellite-detected fire hotspots for a given simulation hour.
        Stubble burning has strong diurnal cycle (farmers ignite fields between 13:00 and 17:00 IST).
        """
        hour_local = hour % 24.0
        # Diurnal ignition curve peaking at 15:00
        ignition_peak = math.exp(-((hour_local - 15.0) ** 2.0) / 18.0)
        activity_factor = 0.3 + 0.7 * ignition_peak
        
        hotspots = []
        for cluster in REGIONAL_FIRE_CLUSTERS:
            # Seed pseudo-random variation based on cluster id and hour
            rng = random.Random(hash(cluster["id"]) + int(hour))
            frp = cluster["base_frp"] * activity_factor * intensity_multiplier * (0.85 + 0.3 * rng.random())
            
            # Injection height
            pbl_est = 400.0 if (7 <= hour_local <= 18) else 180.0
            injection_h = self.calculate_plume_injection_height(frp, pbl_est)
            
            # Distance and bearing to Delhi
            d_lat = DELHI_RECEPTOR["lat"] - cluster["lat"]
            d_lon = DELHI_RECEPTOR["lon"] - cluster["lon"]
            # Distance in km (approx for 28-31 deg N)
            dist_km = math.sqrt((d_lat * 111.0) ** 2.0 + (d_lon * 96.0) ** 2.0)
            
            hotspots.append({
                "id": cluster["id"],
                "name": cluster["name"],
                "state": cluster["state"],
                "lat": cluster["lat"] + (rng.random() - 0.5) * 0.05,
                "lon": cluster["lon"] + (rng.random() - 0.5) * 0.05,
                "frp_mw": round(frp, 1),
                "acres_burning": int(cluster["acres_burning"] * activity_factor * intensity_multiplier),
                "injection_height_m": injection_h,
                "emission_rate_kgs": round(frp * self.frp_to_emission_rate, 2),
                "distance_to_delhi_km": round(dist_km, 1),
                "transport_time_hours": round(dist_km / 18.0, 1),  # assuming ~18 km/h advection
                "satellite_sensor": "VIIRS / MODIS Active Fire"
            })
            
        return hotspots

    def generate_lagrangian_plume_particles(
        self, 
        hour: float, 
        intensity_multiplier: float = 1.0, 
        wind_speed_ms: float = 3.0,
        inversion_strength_c: float = 6.0,
        capping_height_m: float = 250.0
    ) -> List[Dict[str, Any]]:
        """
        Generates Lagrangian plume particles transported downwind across the Indo-Gangetic Plain.
        Visualizes smoke puff positions, dispersion spread, altitude, and ground fumigation intensity.
        """
        particles = []
        hotspots = self.get_fire_hotspots(hour, intensity_multiplier)
        
        # Wind vector: North-Westerly synoptic flow (blowing towards South-East: ~135 deg heading)
        wind_heading_rad = math.radians(130.0 + 8.0 * math.sin(hour * 0.15))
        
        # Inversion trapping factor: high inversion forces particles down to surface layer
        trapping_active = (inversion_strength_c >= 4.0)
        
        for cluster in hotspots:
            rng = random.Random(hash(cluster["id"]) + int(hour * 3))
            # Number of puff particles proportional to FRP
            num_puffs = int(max(6, min(24, cluster["frp_mw"] / 28.0)))
            
            for i in range(num_puffs):
                # Age of particle (hours since emission: 0 to 22h)
                age_h = (i / num_puffs) * 20.0 + rng.random() * 1.5
                
                # Travel distance along wind vector
                travel_km = age_h * (wind_speed_ms * 3.6)
                
                # Delta lat/lon
                dx_km = travel_km * math.sin(wind_heading_rad)
                dy_km = travel_km * math.cos(wind_heading_rad)
                
                # Cross-wind Gaussian spread (sigma_y grows with downwind distance)
                # Atmospheric stability class E/F: sigma_y ~ 0.08 * x^0.9
                sigma_y_km = 0.08 * (max(1.0, travel_km) ** 0.88)
                cross_dispersion = (rng.gauss(0, 1) * sigma_y_km)
                
                perp_heading_rad = wind_heading_rad + math.pi / 2.0
                p_lat = cluster["lat"] + (dy_km + cross_dispersion * math.cos(perp_heading_rad)) / 111.0
                p_lon = cluster["lon"] + (dx_km + cross_dispersion * math.sin(perp_heading_rad)) / 96.0
                
                # Particle altitude & Inversion Capping Reflection
                init_z = cluster["injection_height_m"]
                if trapping_active:
                    # Inversion traps particles below capping height
                    p_z = min(capping_height_m * 0.9, init_z * math.exp(-age_h * 0.08) + 40.0)
                    fumigation = True
                else:
                    p_z = init_z + age_h * 15.0
                    fumigation = False
                    
                # Particle concentration (attenuates with age due to dispersion & deposition)
                dispersion_factor = 1.0 / (1.0 + 0.12 * travel_km)
                # Inversion fumigation concentrates smoke near ground
                concentration = cluster["frp_mw"] * 0.9 * dispersion_factor * (1.8 if fumigation else 1.0)
                
                # Filter to domain bounds: 27.5 N to 32.0 N, 74.0 E to 78.5 E
                if 27.5 <= p_lat <= 32.2 and 73.8 <= p_lon <= 78.8:
                    particles.append({
                        "id": f"{cluster['id']}-p{i}",
                        "source_id": cluster["id"],
                        "lat": round(p_lat, 4),
                        "lon": round(p_lon, 4),
                        "altitude_m": round(p_z, 1),
                        "age_hours": round(age_h, 1),
                        "concentration_ug_m3": round(concentration, 1),
                        "is_trapped_by_inversion": fumigation,
                        "size": round(max(3.0, min(14.0, concentration / 25.0)), 1)
                    })
                    
        return particles

    def compute_airshed_density_grid(
        self, 
        hour: float, 
        intensity_multiplier: float = 1.0
    ) -> Dict[str, Any]:
        """
        Computes 2D spatial smoke density field over Delhi NCR and surrounding states
        for contour heatmap rendering.
        Domain: Lat [28.0, 31.5] (step 0.25), Lon [74.5, 78.0] (step 0.25)
        """
        lat_step = 0.25
        lon_step = 0.25
        lats = [round(28.0 + i * lat_step, 2) for i in range(15)]
        lons = [round(74.5 + j * lon_step, 2) for j in range(15)]
        
        particles = self.generate_lagrangian_plume_particles(hour, intensity_multiplier)
        
        grid_data = []
        for lat in lats:
            row = []
            for lon in lons:
                # Accumulate influence from all particles in neighborhood
                cell_density = 0.0
                for p in particles:
                    d_lat = lat - p["lat"]
                    d_lon = lon - p["lon"]
                    dist_sq = (d_lat * 111.0) ** 2.0 + (d_lon * 96.0) ** 2.0
                    if dist_sq < 3600.0:  # within 60 km
                        weight = math.exp(-dist_sq / 800.0)
                        cell_density += p["concentration_ug_m3"] * weight * 0.15
                        
                # Urban background baseline
                is_near_delhi = math.sqrt((lat - 28.61) ** 2 + (lon - 77.23) ** 2) < 0.45
                urban_bg = 95.0 if is_near_delhi else 45.0
                
                total_val = round(cell_density + urban_bg, 1)
                row.append(total_val)
            grid_data.append(row)
            
        return {
            "lats": lats,
            "lons": lons,
            "bounds": {"min_lat": 28.0, "max_lat": 31.5, "min_lon": 74.5, "max_lon": 78.0},
            "density_matrix": grid_data
        }
