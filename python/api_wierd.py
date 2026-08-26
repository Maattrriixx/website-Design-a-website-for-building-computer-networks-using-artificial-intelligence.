from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import wired_designer

app = FastAPI()

@app.post("/wired")
async def wired_network(request: Request):
    try:
        data = await request.json()
        rooms = data.get('rooms', [])
        scale = float(data.get('scale', 0.05))

        if not rooms:
            return JSONResponse(status_code=400, content={"error": "Missing 'rooms' list"})

        result = wired_designer.run_wired_optimizer(rooms, scale)
        return JSONResponse(content=result)

    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8003)