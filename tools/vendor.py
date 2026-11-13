"""Fetch pinned open-source runtime dependencies and a provenance-tagged world base."""
import hashlib, io, json, pathlib, tarfile, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
WEB = ROOT / 'App' / 'Web'
packages = [('fflate','0.8.2','package/umd/index.js','fflate.js'),('polygon-clipping','0.15.7','package/dist/polygon-clipping.umd.js','polygon-clipping.js'),('milsymbol','3.0.3','package/dist/milsymbol.js','milsymbol.js')]
manifest=[]
for name, version, member, target in packages:
    url=f'https://registry.npmjs.org/{name}/-/{name}-{version}.tgz'
    raw=urllib.request.urlopen(url,timeout=60).read()
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as archive:
        data=archive.extractfile(member).read()
        (WEB/'vendor'/target).write_bytes(data)
        for info in archive.getmembers():
            if info.name.lower() in ['package/license','package/license.md','package/license.txt']:
                (WEB/'vendor'/f'{name}.LICENSE').write_bytes(archive.extractfile(info).read())
    manifest.append({'name':name,'version':version,'url':url,'sha256':hashlib.sha256(data).hexdigest()})
url='https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'
raw=urllib.request.urlopen(url,timeout=60).read()
world=json.loads(raw)
for f in world['features']:
    p=f['properties']
    f['properties']={k:p.get(k) for k in ['ADMIN','NAME','NAME_ZH','ADM0_A3','ISO_A2','ISO_A2_EH','SOV_A3','SOVEREIGNT','TYPE','LABEL_X','LABEL_Y']}
(WEB/'data'/'world.js').write_text('globalThis.BASE_WORLD = '+json.dumps(world,ensure_ascii=False,separators=(',',':'))+';\n')
manifest.append({'name':'Natural Earth admin0 110m','version':'downloaded 2026-11-13','url':url,'license':'Public domain','sha256':hashlib.sha256(raw).hexdigest(),'coverage':'Country-scale base, not a verified 2026 or 1816 administrative scenario'})
(WEB/'vendor'/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print('Fetched',len(packages),'libraries and',len(world['features']),'country features')
