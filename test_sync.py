import urllib.request, json

req = urllib.request.Request('https://kvdb.io/', data=b'', method='POST', headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req) as resp:
        bucket = resp.read().decode('utf-8').strip()
        print('Created bucket:', bucket)
        
        # Test write
        payload = json.dumps({'name': 'PT MAKMUR', 'bgl': 15.0}).encode('utf-8')
        w_req = urllib.request.Request(f'https://kvdb.io/{bucket}/ptmakmur_state', data=payload, method='POST')
        with urllib.request.urlopen(w_req) as w_resp:
            print('Write status:', w_resp.status)
            
        # Test read
        r_req = urllib.request.Request(f'https://kvdb.io/{bucket}/ptmakmur_state')
        with urllib.request.urlopen(r_req) as r_resp:
            print('Read data:', r_resp.read().decode('utf-8'))
except Exception as e:
    print('Error:', e)
