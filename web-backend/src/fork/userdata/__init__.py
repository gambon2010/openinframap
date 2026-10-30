"""
Fork: "My layers" storage (schema: userdata.sql; frontend:
web/src/fork/modules/userlayers/).

The browser keeps unsaved changes and sends them all with "Save" (POST
/userdata/save); each is applied and logged with its state before and after, so
the history can be played back (GET /userdata/history). Also situations (named
points in that history) and images people put on the map.

- schema.py: the userdata schema, made on first use
- users.py: who is asking (one place for login and access control, later)
- changes.py: applying and logging changes (no HTTP)
- layers.py: the layers, Save and the history
- situations.py, images.py
"""

from starlette.routing import Route

from . import images, layers, situations

routes = [
    Route("/userdata", endpoint=layers.everything),
    Route("/userdata/save", endpoint=layers.save, methods=["POST"]),
    Route("/userdata/history", endpoint=layers.history),
    Route("/userdata/situations", endpoint=situations.situations, methods=["GET", "POST"]),
    Route("/userdata/situations/{situation_id}", endpoint=situations.delete_situation, methods=["DELETE"]),
    Route("/userdata/images", endpoint=images.add_image, methods=["POST"]),
    Route("/userdata/images/{image_id}", endpoint=images.get_image),
]
