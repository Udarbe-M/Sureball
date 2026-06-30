# Coaching Clip Validation

This folder is for real shooting, dribbling, and passing clips with human-labeled expected counts.

## How Validation Works

1. Record a short clip where one player is visible and the ball stays in frame.
2. Count the real actions by hand:
   - Shooting: count shot attempts, makes, misses, and accuracy.
   - Dribbling: count controlled low ball contacts.
   - Passing: count releases after the player has controlled the ball.
3. Add the clip path and expected count to `coaching_clip_manifest.example.json` or a copied manifest.
4. Start the backend, then run:

```powershell
backend\.venv\Scripts\python.exe backend\tools\validate_coaching_clips.py --manifest backend\validation\coaching_clip_manifest.example.json
```

The script uploads each clip to the coaching-video endpoint, waits for processing, then compares the backend action count to the human label using the sample's tolerance. For Shooting clips, it also compares makes, misses, and accuracy when those labels are present.

## How Coaching Works

SureBall combines two signals:

- YOLOv11 ball detection finds the basketball location in each analyzed frame.
- MediaPipe pose estimation finds body landmarks such as shoulders, elbows, wrists, hips, and knees.

For dribbling, the system watches for the ball in a low zone and counts a new dribble when a controlled low contact starts after a cooldown window.

For passing, the system watches for controlled possession near the body, then counts a pass when the ball separates into a release window after that controlled state.

For shooting, the system uses the shot-training detector labels to count shot attempts, makes, misses, and accuracy while the coaching pipeline continues to score form using YOLOv11 ball tracking and MediaPipe pose estimation.

Feedback is generated from the same visible features, including ball height zone, ball-body offset, elbow/wrist alignment, comfortable knee load, torso control, and balance. The score is a rule-based coaching score built from those feature checks, while direct hand-distance measurement is kept out of the shooting score because it is not reliable enough in uploaded clips.
