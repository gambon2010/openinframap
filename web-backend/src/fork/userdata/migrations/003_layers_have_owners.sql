-- Every layer has an owner. Layers made before there were accounts had none and
-- were open to everyone, with rules of their own in the backend and the sharing
-- window. They get the first admin as owner, and every other account keeps
-- "can change", as it had: then those rules are gone. (With no admin yet, they
-- stay as they are, out of reach until someone gives them an owner by hand.)
INSERT INTO userdata.layer_access (layer_id, user_id, level)
SELECT l.id, u.id, 'modify'
  FROM userdata.layer AS l
  CROSS JOIN userdata.app_user AS u
 WHERE l.owner_id IS NULL
   AND u.id <> (SELECT min(id) FROM userdata.app_user WHERE is_admin AND NOT disabled)
ON CONFLICT DO NOTHING;

UPDATE userdata.layer
   SET owner_id = (SELECT min(id) FROM userdata.app_user WHERE is_admin AND NOT disabled)
 WHERE owner_id IS NULL
   AND EXISTS (SELECT 1 FROM userdata.app_user WHERE is_admin AND NOT disabled);
