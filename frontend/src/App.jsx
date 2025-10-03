import React, {useState} from 'react'
import axios from 'axios'

function defaultSdfs(){ return [{dist:6.0, alt:1500},{dist:4.5, alt:1000},{dist:2.0, alt:700}]; }

export default function App(){
  const [ident,setIdent] = useState('RWY24')
  const [thrElev,setThrElev] = useState(15)
  const [dmeToThr,setDmeToThr] = useState(4.0)
  const [todAlt,setTodAlt] = useState(3000)
  const [todDist,setTodDist] = useState(8.0)
  const [mda,setMda] = useState(620)
  const [fafDist,setFafDist] = useState(2.8)
  const [sdfs,setSdfs] = useState(defaultSdfs())
  const [overrideAngle,setOverrideAngle] = useState('')
  const [result,setResult] = useState(null)
  const [warnings,setWarnings] = useState([])

  const addSdf = ()=> setSdfs([...sdfs, {dist:3.0,alt:1200}])
  const updateSdf = (i,k,v)=> { const arr = [...sdfs]; arr[i][k]=v; setSdfs(arr);} 
  const removeSdf = i=> setSdfs(sdfs.filter((_,idx)=>idx!==i))

  async function compute(){
    const payload = {ident, thrElev, dmeToThr, todAlt, todDist, mda, fafDist, sdfs, overrideAngle: overrideAngle||null}
    try{
      const res = await axios.post('/api/compute', payload)
      setResult(res.data)
      const ws = []
      if (res.data.raisedTo3) ws.push('Angle raised to 3.0° per Navblue rule')
      if (res.data.publishedAngle > 4.5) ws.push('Published angle > 4.5° — add note before publishing')
      setWarnings(ws)
    }catch(err){
      alert('API error — make sure backend is running. '+(err.message||''))
    }
  }

  return (<div className="container">
    <h1>DME / CDFA Tool (Full App)</h1>
    <div style={{display:'flex',gap:12}}>
      <div style={{width:380}} className="card">
        <label>IDENT</label><input value={ident} onChange={e=>setIdent(e.target.value)} />
        <label>THR Elev (ft)</label><input type="number" value={thrElev} onChange={e=>setThrElev(Number(e.target.value))} />
        <label>DME to THR (NM)</label><input type="number" step="0.01" value={dmeToThr} onChange={e=>setDmeToThr(Number(e.target.value))} />
        <label>TOD Alt (ft)</label><input type="number" value={todAlt} onChange={e=>setTodAlt(Number(e.target.value))} />
        <label>TOD Dist (NM)</label><input type="number" step="0.01" value={todDist} onChange={e=>setTodDist(Number(e.target.value))} />
        <label>MDA (ft)</label><input type="number" value={mda} onChange={e=>setMda(Number(e.target.value))} />
        <label>FAF Dist (NM)</label><input type="number" step="0.01" value={fafDist} onChange={e=>setFafDist(Number(e.target.value))} />
        <label>Override GP Angle (deg)</label><input type="number" step="0.1" value={overrideAngle} onChange={e=>setOverrideAngle(e.target.value)} />
        <hr style={{margin:'8px 0'}} />
        <h4>SDFs</h4>
        {sdfs.map((s,i)=> (
          <div key={i} style={{display:'flex',gap:6,marginBottom:6}}>
            <input style={{width:90}} type="number" step="0.01" value={s.dist} onChange={e=>updateSdf(i,'dist',Number(e.target.value))} />
            <input style={{flex:1}} type="number" value={s.alt} onChange={e=>updateSdf(i,'alt',Number(e.target.value))} />
            <button onClick={()=>removeSdf(i)} className="small">×</button>
          </div>
        ))}
        <button onClick={addSdf}>Add SDF</button>
        <div style={{marginTop:10}}>
          <button onClick={compute}>Compute & Draw</button>
        </div>
      </div>

      <div style={{flex:1}} className="card">
        <h3>Outputs</h3>
        <div>
          {warnings.map((w,i)=>(<div key={i} style={{color:'#ff6b6b'}}>{w}</div>))}
        </div>
        {result && (
          <div>
            <div style={{marginTop:8}}>Published Angle: <b>{result.publishedAngle}°</b></div>
            <div style={{marginTop:8}} className="table">
              <table style={{width:'100%'}}>
                <thead><tr><th>DME</th><th>Dist</th><th>Alt</th><th>Slant</th></tr></thead>
                <tbody>
                  {result.table.map((r,i)=>(
                    <tr key={i}><td>{r.dme.toFixed(2)}</td><td>{r.dist.toFixed(2)}</td><td>{r.altRounded}</td><td>{r.slantNm.toFixed(3)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  </div>)
}
