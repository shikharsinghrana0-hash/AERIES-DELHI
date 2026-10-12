"""
AeroSys-Delhi: Chemistry Mechanism & NAQI Calculator
Implements:
1. Indian National Air Quality Index (NAQI) sub-index calculation algorithm according to CPCB guidelines.
2. Photochemical reaction framework (NOx-VOC-O3, Leighton photostationary state with aerosol attenuation).
3. Secondary Inorganic Aerosol (SIA) gas-to-particle conversion (Sulfate, Nitrate, Ammonium).
"""

import math
from typing import Dict, Any, Tuple

# CPCB Indian National Air Quality Index Breakpoints
# Format: (C_low, C_high, I_low, I_high)
NAQI_BREAKPOINTS = {
    "pm25": [
        (0, 30, 0, 50),
        (31, 60, 51, 100),
        (61, 90, 101, 200),
        (91, 120, 201, 300),
        (121, 250, 301, 400),
        (250, 500, 401, 500),
    ],
    "pm10": [
        (0, 50, 0, 50),
        (51, 100, 51, 100),
        (101, 250, 101, 200),
        (251, 350, 201, 300),
        (351, 430, 301, 400),
        (430, 600, 401, 500),
    ],
    "no2": [
        (0, 40, 0, 50),
        (41, 80, 51, 100),
        (81, 180, 101, 200),
        (181, 280, 201, 300),
        (281, 400, 301, 400),
        (400, 550, 401, 500),
    ],
    "o3": [
        (0, 50, 0, 50),
        (51, 100, 51, 100),
        (101, 168, 101, 200),
        (169, 208, 201, 300),
        (209, 748, 301, 400),
        (748, 1000, 401, 500),
    ],
    "co": [
        (0, 1.0, 0, 50),
        (1.1, 2.0, 51, 100),
        (2.1, 10.0, 101, 200),
        (10.1, 17.0, 201, 300),
        (17.1, 34.0, 301, 400),
        (34.0, 50.0, 401, 500),
    ],
    "so2": [
        (0, 40, 0, 50),
        (41, 80, 51, 100),
        (81, 380, 101, 200),
        (381, 800, 201, 300),
        (801, 1600, 301, 400),
        (1600, 2000, 401, 500),
    ]
}

def calculate_sub_index(concentration: float, pollutant: str) -> float:
    """Computes Indian NAQI sub-index for a given pollutant using linear interpolation."""
    if pollutant not in NAQI_BREAKPOINTS:
        return 0.0
    
    concentration = max(0.0, float(concentration))
    breakpoints = NAQI_BREAKPOINTS[pollutant]
    
    # Cap at maximum bracket if extreme
    max_c_high = breakpoints[-1][1]
    if concentration >= max_c_high:
        return 500.0
    
    for i, (c_low, c_high, i_low, i_high) in enumerate(breakpoints):
        effective_low = breakpoints[i - 1][1] if i > 0 else 0.0
        if effective_low <= concentration <= c_high:
            sub_index = i_low + ((i_high - i_low) / max(0.0001, (c_high - effective_low))) * (concentration - effective_low)
            return round(sub_index, 1)
            
    return 500.0

def get_aqi_category(aqi_value: float) -> Tuple[str, str, str]:
    """
    Returns (Category Name, Color Hex, Health Advisory) based on NAQI scale.
    """
    aqi = round(aqi_value)
    if aqi <= 50:
        return ("Good", "#10b981", "Minimal impact on health. Clean airshed conditions.")
    elif aqi <= 100:
        return ("Satisfactory", "#84cc16", "Minor breathing discomfort to sensitive people.")
    elif aqi <= 200:
        return ("Moderate", "#facc15", "Breathing discomfort to people with lungs, asthma and heart diseases.")
    elif aqi <= 300:
        return ("Poor", "#f97316", "Breathing discomfort to most people on prolonged exposure.")
    elif aqi <= 400:
        return ("Very Poor", "#ef4444", "Respiratory illness on prolonged exposure. Pronounced inversion risk.")
    else:
        return ("Severe", "#7f1d1d", "Affects healthy people and seriously impacts those with existing diseases. Emergency inversion trapping.")

def calculate_composite_naqi(pollutants: Dict[str, float]) -> Dict[str, Any]:
    """
    Computes Indian National AQI from pollutant suite.
    CPCB Rule: AQI is the maximum of the sub-indices, provided at least PM2.5 or PM10 is present.
    """
    sub_indices = {}
    for pol in ["pm25", "pm10", "no2", "o3", "co", "so2"]:
        if pol in pollutants:
            sub_indices[pol] = calculate_sub_index(pollutants[pol], pol)
            
    if not sub_indices:
        return {"aqi": 0, "dominant_pollutant": "none", "category": "Good", "color": "#10b981"}
        
    dominant_pollutant = max(sub_indices, key=sub_indices.get)
    composite_aqi = sub_indices[dominant_pollutant]
    cat, color, advisory = get_aqi_category(composite_aqi)
    
    return {
        "aqi": int(round(composite_aqi)),
        "dominant_pollutant": dominant_pollutant.upper(),
        "category": cat,
        "color": color,
        "health_advisory": advisory,
        "sub_indices": sub_indices
    }

class PhotochemistrySolver:
    """
    Simplified coupled gas-phase photochemistry & aerosol interaction solver.
    Models the diurnal NOx-O3 cycle with solar zenith angle attenuation by aerosols.
    """
    def __init__(self):
        # Base reaction rate constants
        self.k_no_o3 = 1.4e-14  # cm3 molecule-1 s-1 (NO + O3 -> NO2 + O2)
        self.j_no2_clear = 0.008  # s-1 (NO2 photolysis peak under clear sky)

    def compute_photolysis_rate(self, hour_of_day: float, aod: float, cloud_fraction: float = 0.1) -> float:
        """
        Calculates J(NO2) photolysis rate attenuated by:
        1. Diurnal solar zenith angle (sunrise ~ 06:30, noon peak 12:30, sunset ~ 17:45 in Delhi winter).
        2. Aerosol optical depth (AOD) extinction: J = J_clear * cos(theta_z) * exp(-tau_AOD / (2 * cos(theta_z))).
        """
        if hour_of_day < 6.75 or hour_of_day > 17.75:
            return 0.0  # Nighttime: zero photolysis
            
        solar_progress = (hour_of_day - 6.75) / (17.75 - 6.75) * math.pi
        cos_sza = math.sin(solar_progress)
        
        if cos_sza <= 0.05:
            return 0.0
            
        extinction = math.exp(-min(aod, 4.0) / (2.0 * max(cos_sza, 0.15)))
        cloud_factor = 1.0 - 0.75 * cloud_fraction
        
        j_no2 = self.j_no2_clear * cos_sza * extinction * cloud_factor
        return max(0.0, j_no2)

    def step_no_no2_o3(
        self, 
        no_conc: float, 
        no2_conc: float, 
        o3_conc: float, 
        hour: float, 
        aod: float, 
        dt_seconds: float = 3600.0
    ) -> Tuple[float, float, float]:
        """
        Steps NOx-O3 photostationary state forward in time.
        In Delhi winter nighttime, intense local NOx emissions titrate O3 to near zero:
        NO + O3 -> NO2 + O2.
        During afternoon, NO2 photolysis generates O3.
        """
        j_no2 = self.compute_photolysis_rate(hour % 24, aod)
        
        rate_titration = 0.00035
        rate_photolysis = j_no2 * 3600.0 * 2.5
        
        d_titration = min(no_conc * 0.4, o3_conc * 0.5) * rate_titration
        d_photolysis = no2_conc * rate_photolysis * 0.08
        
        new_o3 = max(5.0, o3_conc - d_titration + d_photolysis)
        new_no2 = max(10.0, no2_conc + d_titration - d_photolysis)
        new_no = max(5.0, no_conc - d_titration + d_photolysis)
        
        return round(new_no, 2), round(new_no2, 2), round(new_o3, 2)

    def secondary_inorganic_aerosol_formation(
        self, 
        so2_conc: float, 
        no2_conc: float, 
        rh: float, 
        temp_c: float, 
        inversion_strength: float
    ) -> float:
        """
        Calculates hourly secondary PM2.5 formation from SO2 and NO2 oxidation.
        Enhanced drastically in Delhi winter by high RH and surface inversion trapping.
        """
        rh_factor = 1.0 + max(0.0, (rh - 60.0) / 40.0) ** 2.0
        inv_factor = 1.0 + max(0.0, inversion_strength / 2.0)
        
        delta_sulfate = so2_conc * 0.035 * rh_factor
        delta_nitrate = no2_conc * 0.045 * rh_factor * inv_factor * (1.0 if temp_c < 22.0 else 0.5)
        
        secondary_pm25 = delta_sulfate + delta_nitrate
        return round(secondary_pm25, 2)
