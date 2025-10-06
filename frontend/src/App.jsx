import React, {useState} from 'react'
import axios from 'axios'

function defaultSdfs(){ return [{dist:6.0, alt:1500},{dist:4.5, alt:1000},{dist:2.0, alt:700}]; }

export default function App(){
  const [ident,setIdent] = useState('RWY24')
  const [gpAngle,setGpAngle] = useState('') // optional override
  const [thrElev,setThrElev] = useState(15)
  const [dmeAtThr,setDmeAtThr] = useState(4.0)
  const [todAlt,setTodAlt] = useState(3000)
  const [todDist,setTodDist] = useState(8.0)
  const [mda,setMda] = useState(620)
  const [fafDist,setFafDist] = useState(2.8)
  const [sdfs,setSdfs] = useState(defaultSdfs())
  const [grounds,setGrounds] = useState([80,100,120,140,160])
  const [result,setResult] = useState(null)
  const [loading,setLoading] = useState(false)
  const [warnings,setWarnings] = useState([])

  const addSdf = ()=> setSdfs([...sdfs, {dist:3.0,alt:1200}])
  const updateSdf = (i,k,v)=> { const arr = [...sdfs]; arr[i][k]=v; setSdfs(arr); }
  const removeSdf = i=> setSdfs(sdfs.filter((_,idx)=>idx!==i))

  async function compute(){
    setLoading(true)
    setWarnings([])
    try{
      const payload = {
        ident,
        gpAngle: gpAngle? Number(gpAngle): null,
        thrElev: Number(thrElev),
        dmeAtThr: Number(dmeAtThr),
        todAlt: Number(todAlt),
        todDist: Number(todDist),
        mda: Number(mda),
        sdfs,
        fafDist: fafDist? Number(fafDist): null,
        grounds
      }
      const res = await axios.post('/api/compute', payload)
      setResult(res.data)
      const ws = []
      if (res.data.raisedDueToMinRule) ws.push(`Computed angle was <2.5° → raised to ${res.data.publishedAngle_deg}°`)
      if (res.data.angleAdjustedForSDF) ws.push('Published angle adjusted for SDF constraints')
      setWarnings(ws)
    }catch(err){
      alert('Compute failed: '+(err.message||''))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <div className="header">
        <h2 style={{color:'#dff7f0'}}>DME & ROD — CDFA Tool</h2>
        <div className="small-muted">Cockpit-friendly UI</div>
      </div>

      <div className="card" style={{marginBottom:12}}>
        <div style={{display:'flex', gap:12}}>
          <div style={{flex:1}}>
            <div className="form-grid">
              <div className="field">
                <label>IDENT</label>
                <input value={ident} onChange={e=>setIdent(e.target.value)} />
              </div>
              <div className="field">
                <label>GP Angle (°) — optional override</label>
                <input value={gpAngle} onChange={e=>setGpAngle(e.target.value)} placeholder="e.g. 3.0" />
              </div>
              <div className="field">
                <label>THR / TDZE Elevation (ft)</label>
                <input type="number" value={thrElev} onChange={e=>setThrElev(e.target.value)} />
              </div>
              <div className="field">
                <label>DME reading at THR (nm)</label>
                <input type="number" step="0.01" value={dmeAtThr} onChange={e=>setDmeAtThr(e.target.value)} />
              </div>
              <div className="field">
                <label>Top of Descent Altitude (ft)</label>
                <input type="number" value={todAlt} onChange={e=>setTodAlt(e.target.value)} />
              </div>
              <div className="field">
                <label>Top of Descent Dist from THR (nm)</label>
                <input type="number" step="0.01" value={todDist} onChange={e=>setTodDist(e.target.value)} />
              </div>
              <div className="field">
                <label>MDA (ft)</label>
                <input type="number" value={mda} onChange={e=>setMda(e.target.value)} />
              </div>
              <div className="field">
                <label>FAF - MAPt Dist (nm)</label>
                <input type="number" step="0.01" value={fafDist} onChange={e=>setFafDist(e.target.value)} />
              </div>
            </div>
            <div style={{marginTop:10}}>
              <label style={{fontWeight:700}}>SDFs (optional — step-down fixes)</label>
              <div style={{marginTop:6}}>
                {sdfs.map((s,i)=>(
                  <div className="sdf-row" key={i}>
                    <input style={{width:90}} type="number" step="0.01" value={s.dist} onChange={e=>updateSdf(i,'dist',Number(e.target.value))} />
                    <input style={{flex:1}} type="number" value={s.alt} onChange={e=>updateSdf(i,'alt',Number(e.target.value))} />
                    <button className="button" style={{padding:'6px 10px'}} onClick={()=>removeSdf(i)}>Remove</button>
                  </div>
                ))}
                <div style={{marginTop:8}}>
                  <button className="button" onClick={addSdf}>Add SDF</button>
                </div>
              </div>
            </div>
          </div>

          <div style={{width:380}}>
            <div className="card">
              <div style={{fontWeight:800,fontSize:15,color:'#dff7f0'}}>Quick settings</div>
              <div style={{marginTop:8}}>
                <label>Groundspeeds (kts) — comma separated</label>
                <input value={grounds.join(',')} onChange={e=>{
                  const arr = e.target.value.split(',').map(s=>Number(s.trim())).filter(Boolean)
                  setGrounds(arr.length?arr:[80,100,120,140,160])
                }} />
              </div>
              <div style={{marginTop:10,display:'flex',gap:8}}>
                <button className="button" onClick={compute} disabled={loading}>{loading? 'Calculating...':'Calculate'}</button>
                <button className="button" onClick={()=>{
                  setIdent('RWY24'); setGpAngle(''); setThrElev(15); setDmeAtThr(4.0); setTodAlt(3000); setTodDist(8.0);
                  setMda(620); setFafDist(2.8); setSdfs(defaultSdfs()); setResult(null); setWarnings([]);
                }}>Reset</button>
              </div>
              <div className="note">Published altitudes are rounded up to 10 ft. Threshold target = THR + 50 ft.</div>
            </div>
          </div>
        </div>
      </div>

      {warnings.length>0 && (
        <div style={{marginBottom:12}}>
          {warnings.map((w,i)=>(<div key={i} className="card" style={{padding:10,marginBottom:6,color:'#ffd7a6'}}>{w}</div>))}
        </div>
      )}

      {result && (
        <div style={{display:'flex',gap:12}}>
          <div className="dme-table card" style={{flex:1}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <div style={{fontWeight:800,fontSize:16,color:'#dff7f0'}}>DIST / ALT Table</div>
                <div className="small-muted">GP: {result.publishedAngle_deg}° · THR target: {result.thrTargetAlt_ft} ft</div>
              </div>
            </div>

            <table style={{marginTop:12}}>
              <thead>
                <tr><th style={{width:'25%'}}>DME (nm)</th><th style={{width:'25%'}}>Dist from THR (nm)</th><th style={{width:'25%'}}>Alt (ft)</th><th style={{width:'25%'}}>Slant (nm)</th></tr>
              </thead>
              <tbody>
                {result.dmeTable.map((r,i)=>(
                  <tr key={i}>
                    <td>{r.dmeReading_nm.toFixed(2)}</td>
                    <td>{r.distFromThr_nm.toFixed(2)}</td>
                    <td><span className="alt-bold">{r.altPublished_ft}</span></td>
                    <td>{r.slantNm.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rod-table card" style={{width:520}}>
            <div style={{fontWeight:800,fontSize:16,color:'#dff7f0'}}>ROD Table & FAF → MAPt</div>
            <div className="small-muted" style={{marginTop:6}}>Published angle: {result.publishedAngle_deg}°</div>

            <table style={{marginTop:12}}>
              <thead>
                <tr>
                  <th style={{width:'22%'}}>GS (kts)</th>
                  <th style={{width:'26%'}}>ROD ({result.publishedAngle_deg}°) fpm</th>
                  <th style={{width:'52%'}}>FAF → MAPt</th>
                </tr>
              </thead>
              <tbody>
                {result.rodTable.map((r,i)=>(
                  <tr key={i}>
                    <td>{r.gs_kts}</td>
                    <td className="alt-bold">{r.rod_fpm}</td>
                    <td>{r.faf_mapt_time? r.faf_mapt_time : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{marginTop:10}} className="small-muted">Note: times show FAF→MAPt at given GS; RODs are computed using exact trig formula.</div>
          </div>
        </div>
      )}

      <div style={{marginTop:14}} className="card">
        <div style={{fontWeight:700,color:'#dff7f0'}}>Graphical Profile</div>
        <svg className="profile-svg" id="profileSVG" viewBox="0 0 1000 300" preserveAspectRatio="none">
          {/* Simple static placeholder. You can extend to draw actual profile using result.dmeTable points */}
        </svg>
      </div>

    </div>
  )
}

