# backend/app.py
from flask import Flask, request, jsonify, send_from_directory
from math import atan2, degrees, radians, tan, sqrt, sin, cos, asin
import os
from flask_cors import CORS

NM_TO_FT = 6076.12
EARTH_RADIUS_M = 6371000.0  # earth radius in meters
M_TO_NM = 1.0 / 1852.0      # meters -> nautical miles

# ---------------------------
# Utility geometry functions
# ---------------------------
def haversine_nm(lat1, lon1, lat2, lon2):
    """
    Great-circle distance between two lat/lon points in nautical miles (NM).
    Uses Haversine formula; lat/lon in decimal degrees.
    """
    # convert to radians
    phi1 = radians(lat1)
    phi2 = radians(lat2)
    dphi = radians(lat2 - lat1)
    dlambda = radians(lon2 - lon1)

    a = sin(dphi/2.0)**2 + cos(phi1) * cos(phi2) * sin(dlambda/2.0)**2
    c = 2 * asin(min(1.0, sqrt(a)))
    meters = EARTH_RADIUS_M * c
    nm = meters * M_TO_NM
    return nm

# ---------------------------
# Existing CDFA math
# ---------------------------
def compute_angle_from_tod(tod_alt_ft: float, tod_dist_nm: float, thr_target_alt_ft: float) -> float:
    if not tod_dist_nm or tod_dist_nm <= 0:
        return 0.0
    vert_ft = abs(tod_alt_ft - thr_target_alt_ft)
    return degrees(atan2(vert_ft, tod_dist_nm * NM_TO_FT))

def compute_angle_from_sdfs(sdfs, thr_target_alt_ft: float) -> float:
    best = 0.0
    for s in sdfs or []:
        d = float(s.get('dist', 0.0))
        a = float(s.get('alt', 0.0))
        if d <= 0:
            continue
        vert_ft = abs(a - thr_target_alt_ft)
        ang = degrees(atan2(vert_ft, d * NM_TO_FT))
        if ang > best:
            best = ang
    return best

def ceil_to_10ft(alt_ft: float) -> int:
    return int(((int(alt_ft) + 9) // 10) * 10)

def compute_slant_nm(horizontal_nm: float, altitude_ft_above_station: float) -> float:
    return sqrt(max(0.0, horizontal_nm**2) + (altitude_ft_above_station / NM_TO_FT)**2)

def choose_published_angle(original_angle_deg: float, override_angle_deg: float = None):
    if override_angle_deg is not None:
        try:
            published = float(override_angle_deg)
        except:
            published = float(original_angle_deg or 0.0)
    else:
        published = float(original_angle_deg or 0.0)
    raised = False
    if published < 2.5:
        published = 3.0
        raised = True
    return published, raised

def adjust_angle_for_sdf_constraints(initial_angle_deg: float, thr_target_alt_ft: float, sdfs, max_angle_deg: float = 10.0, step_deg: float = 0.1):
    angle = float(initial_angle_deg)
    changed = False
    for _ in range(int((max_angle_deg - angle) / step_deg) + 1):
        ok = True
        a_rad = radians(angle)
        for s in sdfs or []:
            sd = float(s.get('dist', 0.0))
            s_alt = float(s.get('alt', 0.0))
            comp_alt = thr_target_alt_ft + tan(a_rad) * (sd * NM_TO_FT)
            if comp_alt + 0.0001 < s_alt:
                ok = False
                break
        if ok:
            break
        angle += step_deg
        changed = True
        if angle > max_angle_deg:
            break
    return angle, changed

def generate_dme_table_using_horizontal(
    thr_elev_ft,
    thr_target_alt_ft,
    published_angle_deg,
    max_entries=8,
    max_distance_nm=None,
    start_near_thr_nm=0.5
):
    """
    Generate table using HORIZONTAL distances from threshold (NM).
    For LNAV/waypoint-based procedures we must use horizontal distances (not slant).
    """
    a_rad = radians(published_angle_deg)
    if max_distance_nm is None:
        max_distance_nm = max((max_entries - 1) * 0.5, 1.0)

    if start_near_thr_nm >= max_distance_nm:
        start_near_thr_nm = max_distance_nm / max_entries if max_entries > 0 else 0.0

    if max_entries == 1:
        distances = [start_near_thr_nm]
    else:
        step = (max_distance_nm - start_near_thr_nm) / (max_entries - 1)
        distances = [round(start_near_thr_nm + i * step, 5) for i in range(max_entries)]

    rows = []
    for d_nm in distances:
        # horizontal distance from threshold is d_nm
        alt_ft = thr_target_alt_ft + tan(a_rad) * (d_nm * NM_TO_FT)
        alt_pub = ceil_to_10ft(alt_ft)
        # For LNAV we will present horizontal distance and optionally show slant to a DME (if dme_at_thr provided)
        rows.append({
            'distFromThr_nm': round(d_nm, 4),
            'altExact_ft': round(alt_ft, 2),
            'altPublished_ft': int(alt_pub)
        })
    return rows

def compute_rod_for_angle(angle_deg, groundspeeds_kts):
    a_rad = radians(angle_deg)
    vertical_per_nm = NM_TO_FT * tan(a_rad)
    rows = []
    for gs in groundspeeds_kts:
        rod = vertical_per_nm * (gs / 60.0)
        rows.append({'gs_kts': int(gs), 'rod_fpm': int(round(rod))})
    return rows

def format_time_for_distance(distance_nm, gs_kts):
    if not distance_nm or gs_kts <= 0:
        return "00:00"
    hours = distance_nm / gs_kts
    total_seconds = int(round(hours * 3600))
    mm = total_seconds // 60
    ss = total_seconds % 60
    return f"{mm:02d}:{ss:02d}"

# ---------------------------
# Main app and API
# ---------------------------
def create_app():
    app = Flask(__name__, static_folder='../frontend/dist', static_url_path='/')
    CORS(app)

    @app.route('/api/compute', methods=['POST'])
    def api_compute():
        data = request.get_json() or {}

        # Inputs (common)
        ident = data.get('ident', '')
        gp_angle = data.get('gpAngle', None)   # optional override
        thr_elev = float(data.get('thrElev', 0.0))
        dme_at_thr = data.get('dmeAtThr', None)
        # make dme_at_thr optional (may be None for LNAV)
        dme_at_thr = float(dme_at_thr) if dme_at_thr is not None else None

        tod_alt = float(data.get('todAlt', 0.0))
        tod_dist = float(data.get('todDist', 0.0))
        mda = data.get('mda', None)
        sdfs = data.get('sdfs', []) or []
        faf_dist = float(data.get('fafDist', 0.0)) if data.get('fafDist') is not None else None
        grounds = data.get('grounds', [80,100,120,140,160])

        # LNAV / waypoint support
        use_waypoints = bool(data.get('useWaypoints', False))
        thr_lat = data.get('thrLat', None)
        thr_lon = data.get('thrLon', None)
        waypoints = data.get('waypoints', []) or []  # list of {'ident','lat','lon'}

        thr_target_alt = thr_elev + 50.0

        # If waypoints used, compute horizontal distances from each waypoint to threshold
        waypoint_distances = []
        if use_waypoints and thr_lat is not None and thr_lon is not None:
            try:
                thr_lat_f = float(thr_lat)
                thr_lon_f = float(thr_lon)
                for wp in waypoints:
                    # validate
                    if 'lat' in wp and 'lon' in wp:
                        lat = float(wp['lat'])
                        lon = float(wp['lon'])
                        dist_nm = haversine_nm(lat, lon, thr_lat_f, thr_lon_f)
                        waypoint_distances.append({
                            'ident': wp.get('ident', ''),
                            'lat': lat,
                            'lon': lon,
                            'distToThr_nm': round(dist_nm, 4)
                        })
            except Exception as e:
                # if lat/lon parsing fails, ignore waypoints and continue
                waypoint_distances = []

        # Compute candidate angles
        # For TOD-based angle: if TOD given in NM and not waypoint-based, use tod_dist; else if TOD not provided use 0
        angle_from_tod = compute_angle_from_tod(tod_alt, tod_dist, thr_target_alt)
        angle_from_sdf = compute_angle_from_sdfs(sdfs, thr_target_alt)

        original_angle = max(angle_from_tod, angle_from_sdf)
        if gp_angle is not None:
            try:
                original_angle = float(gp_angle)
            except:
                pass

        published_angle, raised_to_3 = choose_published_angle(original_angle, gp_angle)

        # SDF constraints: if waypoints provided, SDF distances are assumed horizontal NM from threshold.
        final_angle, angle_changed = adjust_angle_for_sdf_constraints(published_angle, thr_target_alt, sdfs)

        # Build DIST/ALT table
        # Choose max distance:
        candidate_max = 0.0
        if use_waypoints and waypoint_distances:
            candidate_max = max([wp['distToThr_nm'] for wp in waypoint_distances] + [tod_dist or 0.0, faf_dist or 0.0])
        else:
            candidate_max = max([tod_dist or 0.0] + [s.get('dist', 0.0) for s in sdfs] + ([faf_dist] if faf_dist else [0.0]))

        if candidate_max < 1.0:
            candidate_max = max(1.0, (8 - 1) * 0.5)

        # If LNAV (waypoints) mode: generate table using horizontal distances
        if use_waypoints and waypoint_distances:
            dme_table = generate_dme_table_using_horizontal(
                thr_elev_ft=thr_elev,
                thr_target_alt_ft=thr_target_alt,
                published_angle_deg=final_angle,
                max_entries=8,
                max_distance_nm=candidate_max,
                start_near_thr_nm=0.5
            )
            # augment table rows with any waypoint markers that match (approx) distance
            # If a waypoint sits near a table distance, annotate it
            for row in dme_table:
                markers = []
                for wp in waypoint_distances:
                    if abs(wp['distToThr_nm'] - row['distFromThr_nm']) <= 0.25:
                        markers.append({'ident': wp['ident'], 'distToThr_nm': wp['distToThr_nm']})
                row['waypointMarkers'] = markers
        else:
            # legacy: use dme_to_thr if provided to compute dmeReading etc.
            # If dme_at_thr not provided, we still build horizontal-based table and mark dmeReading as null
            dme_to_thr_nm = dme_at_thr if dme_at_thr is not None else 0.0
            # Use the horizontal generator but include dmeReading and slant (if dme_at_thr provided)
            # Build base horizontal rows first
            base_rows = generate_dme_table_using_horizontal(
                thr_elev_ft=thr_elev,
                thr_target_alt_ft=thr_target_alt,
                published_angle_deg=final_angle,
                max_entries=8,
                max_distance_nm=candidate_max,
                start_near_thr_nm=0.5
            )
            # augment with dmeReading and slant (if possible)
            dme_table = []
            for r in base_rows:
                d_nm = r['distFromThr_nm']
                if dme_at_thr is not None:
                    dme_reading = round(dme_to_thr_nm - d_nm, 4)
                    alt_above_thr = r['altExact_ft'] - thr_elev
                    slant = compute_slant_nm(abs(dme_reading), alt_above_thr)
                else:
                    dme_reading = None
                    slant = None
                rr = {
                    'distFromThr_nm': r['distFromThr_nm'],
                    'dmeReading_nm': dme_reading,
                    'altExact_ft': r['altExact_ft'],
                    'altPublished_ft': r['altPublished_ft'],
                    'slantNm': round(slant,6) if slant is not None else None
                }
                dme_table.append(rr)

        rod_list = compute_rod_for_angle(final_angle, grounds)

        # compute FAF->MAPt times for each GS if FAF provided
        rod_with_times = []
        for r in rod_list:
            gs = r['gs_kts']
            rod = r['rod_fpm']
            if faf_dist:
                tstr = format_time_for_distance(faf_dist, gs)
            else:
                tstr = None
            rod_with_times.append({'gs_kts': gs, 'rod_fpm': rod, 'faf_mapt_time': tstr})

        resp = {
            'ident': ident,
            'useWaypoints': use_waypoints,
            'waypointDistances': waypoint_distances,
            'thrElev_ft': thr_elev,
            'thrTargetAlt_ft': thr_target_alt,
            'angleFromTOD_deg': round(angle_from_tod, 4),
            'angleFromSDF_deg': round(angle_from_sdf, 4),
            'originalAngle_deg': round(original_angle, 4),
            'publishedAngle_deg': round(final_angle, 4),
            'raisedDueToMinRule': raised_to_3,
            'angleAdjustedForSDF': angle_changed,
            'dmeTable': dme_table,
            'rodTable': rod_with_times,
            'notes': {
                'slant_formula': 'slant^2 = horizontal^2 + (alt_ft/6076.12)^2',
                'target_at_thr': 'threshold target altitude = threshold elevation + 50 ft'
            }
        }
        return jsonify(resp)

    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def serve(path):
        if path != '' and os.path.exists(os.path.join(app.static_folder, path)):
            return send_from_directory(app.static_folder, path)
        else:
            return send_from_directory(app.static_folder, 'index.html')

    return app

if __name__ == '__main__':
    app = create_app()
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))


