# backend/app.py
from flask import Flask, request, jsonify, send_from_directory
from math import atan2, degrees, radians, tan, sqrt
import os
from flask_cors import CORS

NM_TO_FT = 6076.12

def compute_profile(data):
    thr_elev = float(data.get('thrElev', 0))
    dme_to_thr = float(data.get('dmeToThr', 0))
    tod_alt = float(data.get('todAlt', 0))
    tod_dist = float(data.get('todDist', 0))
    mda = float(data.get('mda', 0))
    faf_dist = float(data.get('fafDist', 0))
    sdfs = data.get('sdfs', [])
    override_angle = data.get('overrideAngle', None)

    thr_target_alt = thr_elev + 50

    angle_from_tod = 0.0
    if tod_dist and tod_dist > 0:
        vert_ft = abs(tod_alt - thr_target_alt)
        angle_from_tod = degrees(atan2(vert_ft, tod_dist * NM_TO_FT))

    sdf_angles = []
    for s in sdfs:
        try:
            sd = float(s.get('dist', 0))
            sa = float(s.get('alt', 0))
        except:
            continue
        vert_ft = sa - thr_target_alt
        a = degrees(atan2(abs(vert_ft), sd * NM_TO_FT)) if sd>0 else 0.0
        sdf_angles.append({'sdf': s, 'angleDeg': a})

    chosen_angle = 0.0
    if sdf_angles:
        chosen_angle = max(x['angleDeg'] for x in sdf_angles)

    computed_angle = max(angle_from_tod, chosen_angle)
    if override_angle:
        computed_angle = float(override_angle)

    original_angle = computed_angle
    published_angle = computed_angle
    raised_to_3 = False
    if published_angle < 2.5:
        published_angle = 3.0
        raised_to_3 = True

    max_consider = max([tod_dist] + [s.get('dist', 0) for s in sdfs] + [faf_dist, 1.0])
    n = 8
    step = max(0.5, max_consider / (n-1))
    distances = [round(i * step, 2) for i in range(n)]

    angle_iter = published_angle
    def table_for_angle(angle_deg):
        a_rad = radians(angle_deg)
        return [{'dist': d, 'altFt': thr_target_alt + tan(a_rad) * (d * NM_TO_FT)} for d in distances]

    table = table_for_angle(angle_iter)
    for _ in range(200):
        ok = True
        for t in table:
            for s in sdfs:
                sd = float(s.get('dist', 0))
                sa = float(s.get('alt', 0))
                if abs(sd - t['dist']) < 0.25:
                    if t['altFt'] < sa - 0.0001:
                        ok = False
                        break
            if not ok:
                break
        if ok:
            break
        angle_iter += 0.1
        table = table_for_angle(angle_iter)
        if angle_iter > 10:
            break

    published_angle = round(angle_iter, 2)
    final = []
    for t in table:
        dme_reading = round(dme_to_thr - t['dist'], 2)
        alt_rounded = int(((int(t['altFt']) + 9) // 10) * 10)
        alt_diff = t['altFt'] - thr_elev
        slant = sqrt(max(0, dme_reading**2) + (alt_diff / NM_TO_FT)**2)
        final.append({
            'dist': t['dist'],
            'dme': dme_reading,
            'altFt': t['altFt'],
            'altRounded': alt_rounded,
            'slantNm': slant
        })

    return {
        'thrTargetAlt': thr_target_alt,
        'originalAngle': original_angle,
        'publishedAngle': published_angle,
        'raisedTo3': raised_to_3,
        'table': final
    }

def create_app():
    app = Flask(__name__, static_folder='../frontend/dist', static_url_path='/')
    CORS(app)

    @app.route('/api/compute', methods=['POST'])
    def api_compute():
        data = request.json or {}
        result = compute_profile(data)
        return jsonify(result)

    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def serve(path):
        if path != '' and os.path.exists(os.path.join(app.static_folder, path)):            return send_from_directory(app.static_folder, path)        else:            return send_from_directory(app.static_folder, 'index.html')

    return app

if __name__ == '__main__':
    app = create_app()
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
