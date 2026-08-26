#!/usr/bin/env python3
"""
Floor plan API – rectangle-only version.
YOLO boxes are used directly to create room rectangles.
No GrabCut, no boundary refinement.
"""

import os
import json
import base64
import uuid
import shutil
import cv2
import numpy as np
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers
from ultralytics import YOLO
from flask import Flask, request, jsonify

IMG_SIZE = 512
MODEL_WEIGHTS = "floorplan_segmentation_final.keras"
YOLO_MODEL = "best.pt"
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'bmp'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# --- نموذج التجزئة (نفس المعمارية) ---
def transformer_block(x, num_heads=8, ff_dim=1024, dropout_rate=0.1, survival_prob=0.9):
    attn = layers.MultiHeadAttention(num_heads=num_heads, key_dim=x.shape[-1])(x, x)
    attn = layers.Dropout(dropout_rate)(attn)
    survive = tf.cast(tf.random.uniform(()) < survival_prob, tf.float32)
    x = layers.LayerNormalization(epsilon=1e-6)(x + survive * attn)
    ff = layers.Dense(ff_dim, activation="relu")(x)
    ff = layers.Dense(x.shape[-1])(ff)
    ff = layers.Dropout(dropout_rate)(ff)
    return layers.LayerNormalization(epsilon=1e-6)(x + ff)

def build_full_model():
    base = keras.applications.ResNet50(include_top=False, weights=None,
                                       input_shape=(IMG_SIZE, IMG_SIZE, 3))
    base.trainable = False
    skip1 = base.get_layer("conv2_block3_out").output
    skip2 = base.get_layer("conv3_block4_out").output
    skip3 = base.get_layer("conv4_block6_out").output
    cnn_out = base.get_layer("conv5_block3_out").output
    x = layers.Conv2D(512, 1, padding="same")(cnn_out)
    h, w, c = 16, 16, 512
    x = layers.Reshape((h*w, c))(x)
    pos_emb = layers.Embedding(h*w, c)(tf.range(h*w))
    x = x + pos_emb
    for i in range(4):
        x = transformer_block(x, num_heads=8, ff_dim=1024, dropout_rate=0.1,
                              survival_prob=0.9 - i*0.1)
    transformer_features = layers.LayerNormalization(name='transformer_features')(x)
    x = layers.Reshape((h, w, c))(transformer_features)
    def decoder_block(x, filters, skip=None):
        x = layers.Conv2DTranspose(filters, 2, strides=2, padding="same")(x)
        if skip is not None:
            skip = layers.Conv2D(filters, 1, padding="same")(skip)
            x = layers.Concatenate()([x, skip])
        x = layers.Conv2D(filters, 3, padding="same", activation="relu")(x)
        x = layers.Conv2D(filters, 3, padding="same", activation="relu")(x)
        return x
    x = decoder_block(x, 256, skip3)
    x = decoder_block(x, 128, skip2)
    x = decoder_block(x, 64, skip1)
    x = layers.Conv2DTranspose(32, 2, strides=2, padding="same")(x)
    x = layers.Conv2D(32, 3, padding="same", activation="relu")(x)
    x = layers.Conv2D(32, 3, padding="same", activation="relu")(x)
    x = layers.Conv2DTranspose(16, 2, strides=2, padding="same")(x)
    x = layers.Conv2D(16, 3, padding="same", activation="relu")(x)
    seg_out = layers.Conv2D(1, 1, activation="sigmoid", name="segmentation_mask")(x)
    return keras.Model(inputs=base.input, outputs=[seg_out, transformer_features])

print("Loading models...")
seg_model = build_full_model()
seg_model.load_weights(MODEL_WEIGHTS)
yolo_model = YOLO(YOLO_MODEL)
print("Models loaded.")

def filter_containing_boxes(boxes):
    keep = [True] * len(boxes)
    indices = sorted(range(len(boxes)),
                     key=lambda i: (boxes[i][2]-boxes[i][0]) * (boxes[i][3]-boxes[i][1]))
    for i in range(len(indices)):
        idx_i = indices[i]
        if not keep[idx_i]: continue
        x1_i, y1_i, x2_i, y2_i = boxes[idx_i]
        area_i = (x2_i - x1_i) * (y2_i - y1_i)
        for j in range(i+1, len(indices)):
            idx_j = indices[j]
            if not keep[idx_j]: continue
            x1_j, y1_j, x2_j, y2_j = boxes[idx_j]
            int_x1 = max(x1_i, x1_j); int_y1 = max(y1_i, y1_j)
            int_x2 = min(x2_i, x2_j); int_y2 = min(y2_i, y2_j)
            if int_x2 > int_x1 and int_y2 > int_y1:
                int_area = (int_x2 - int_x1) * (int_y2 - int_y1)
                if int_area / float(area_i) > 0.85:
                    keep[idx_j] = False
    return [boxes[i] for i in range(len(boxes)) if keep[i]]

def predict_rectangles(image_path):
    img_bgr = cv2.imread(image_path)
    if img_bgr is None:
        raise ValueError("Could not read image")
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    img_resized = cv2.resize(img_rgb, (IMG_SIZE, IMG_SIZE))

    # YOLO
    results = yolo_model(img_resized, conf=0.15, iou=0.25)
    raw_boxes, confs = [], []
    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            if cls_id == 0:
                continue
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            w, h = x2 - x1, y2 - y1
            if w > IMG_SIZE*0.65 or h > IMG_SIZE*0.65: continue
            if w < 10 or h < 10: continue
            raw_boxes.append([x1, y1, w, h])
            confs.append(float(box.conf[0]))

    final_boxes = []
    if raw_boxes:
        indices = cv2.dnn.NMSBoxes(raw_boxes, confs, score_threshold=0.15, nms_threshold=0.3)
        if len(indices) > 0:
            for i in indices.flatten():
                rb = raw_boxes[i]
                final_boxes.append((rb[0], rb[1], rb[0]+rb[2], rb[1]+rb[3]))

    if final_boxes:
        final_boxes = filter_containing_boxes(final_boxes)

    if not final_boxes:
        return {'is_valid_blueprint': False, 'rooms': []}

    # Segmentation features
    img_in = np.expand_dims(img_resized.astype(np.float32)/255.0, axis=0)
    seg_pred, feat_pred = seg_model.predict(img_in, verbose=0)
    prob_map = seg_pred[0, :, :, 0]

    rooms = []
    for idx, (x1, y1, x2, y2) in enumerate(final_boxes):
        crop_prob = prob_map[y1:y2, x1:x2]
        if crop_prob.size == 0: continue
        white_ratio = np.mean((crop_prob > 0.5).astype(np.uint8))
        if white_ratio < 0.02:
            continue

        corners = [
            {'x': x1, 'y': y1}, {'x': x2, 'y': y1},
            {'x': x2, 'y': y2}, {'x': x1, 'y': y2}
        ]
        cx = (x1 + x2) // 2
        cy = (y1 + y2) // 2
        feat_x = min(max(int(cx/32),0),15)
        feat_y = min(max(int(cy/32),0),15)
        feat_vec = feat_pred[0, feat_y*16+feat_x, :].tolist()

        rooms.append({
            'room_id': len(rooms)+1,
            'center': {'x': cx, 'y': cy},
            'corners': corners,
            'area_pixels': int((x2-x1)*(y2-y1)),
            'transformer_features': feat_vec,
            'full_contour': np.array([[x1,y1],[x2,y1],[x2,y2],[x1,y2]]).reshape(-1,1,2)
        })

    # Draw
    overlay = img_resized.copy()
    for room in rooms:
        cv2.drawContours(overlay, [room['full_contour']], -1, (0,255,0), 2)
        cv2.circle(overlay, (room['center']['x'], room['center']['y']), 4, (255,0,0), -1)
        cv2.putText(overlay, str(room['room_id']),
                    (room['center']['x']-8, room['center']['y']-8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255,255,255), 2)

    labeled_path = "/tmp/rect_labeled.png"
    cv2.imwrite(labeled_path, cv2.cvtColor(overlay, cv2.COLOR_RGB2BGR))

    for room in rooms:
        del room['full_contour']

    return {
        'is_valid_blueprint': True,
        'rooms': rooms,
        'labeled_image_path': labeled_path
    }

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

@app.route('/predict', methods=['POST'])
def predict():
    if 'image' not in request.files:
        return jsonify({"error": "No image file"}), 400
    file = request.files['image']
    if file.filename == '' or not allowed_file(file.filename):
        return jsonify({"error": "Invalid file"}), 400

    req_id = uuid.uuid4().hex
    upload_dir = f"/tmp/rect_uploads/{req_id}"
    os.makedirs(upload_dir, exist_ok=True)
    img_path = os.path.join(upload_dir, file.filename)
    file.save(img_path)

    try:
        result = predict_rectangles(img_path)
    except Exception as e:
        shutil.rmtree(upload_dir, ignore_errors=True)
        return jsonify({"error": str(e)}), 500

    labeled_b64 = None
    if result.get('labeled_image_path') and os.path.exists(result['labeled_image_path']):
        with open(result['labeled_image_path'], 'rb') as f:
            labeled_b64 = base64.b64encode(f.read()).decode('utf-8')
    shutil.rmtree(upload_dir, ignore_errors=True)

    return jsonify({
        'is_valid_blueprint': result['is_valid_blueprint'],
        'rooms': result.get('rooms', []),
        'labeled_image_base64': labeled_b64
    })

@app.route('/health')
def health():
    return jsonify({"status": "ok"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)