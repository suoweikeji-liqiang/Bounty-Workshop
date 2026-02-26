import urllib.request
import urllib.error
import json

try:
    url = "http://localhost:8000/problems?status=pending_review"
    req = urllib.request.Request(url, headers={'X-User-Id': '1'})
    with urllib.request.urlopen(req) as response:
        print("Status Code:", response.getcode())
        data = response.read().decode()
        print("Body length:", len(data))
        if len(data) > 0:
            print("First few chars:", data[:100])
except urllib.error.HTTPError as e:
    print("Error Code:", e.code)
    print("Error Body:", e.read().decode())
except Exception as e:
    print("Error:", e)
