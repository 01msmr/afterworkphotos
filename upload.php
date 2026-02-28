<?php
require __DIR__ . '/secret.php';
define('SECRET', UPLOAD_SECRET);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') exit('no');
if (($_POST['token'] ?? '') !== SECRET) { http_response_code(403); exit('forbidden'); }

// Debug mode: POST token + debug=1 to see what arrived without making changes
if (!empty($_POST['debug'])) {
    echo json_encode([
        'post_keys'  => array_keys($_POST),
        'files_keys' => array_keys($_FILES),
        'photo_post_len'  => strlen($_POST['photo'] ?? ''),
        'photo_file'      => isset($_FILES['photo']) ? $_FILES['photo'] : null,
        'post_max_size'   => ini_get('post_max_size'),
        'upload_max'      => ini_get('upload_max_filesize'),
        'content_length'  => $_SERVER['CONTENT_LENGTH'] ?? 'n/a',
    ]);
    exit;
}

$base = __DIR__;

$js = file_get_contents("$base/res/main.js");
if (!preg_match('/const PHOTO_COUNT = (\d+)/', $js, $m)) {
    http_response_code(500); exit('could not parse PHOTO_COUNT');
}
$n = (int)$m[1] + 1;

// Accept photo from either $_FILES (File field) or $_POST (Text field with base64)
if (isset($_FILES['photo']) && $_FILES['photo']['error'] === 0) {
    $data = file_get_contents($_FILES['photo']['tmp_name']);
} else {
    $raw = $_POST['photo'] ?? '';
    $raw = preg_replace('/^data:[^;]+;base64,/', '', $raw);
    $data = base64_decode($raw);
}

if (strlen($data) < 100) { http_response_code(400); exit('no photo data'); }

file_put_contents("$base/img/{$n}.jpg", $data);

$js = preg_replace('/const PHOTO_COUNT = \d+/', "const PHOTO_COUNT = {$n}", $js);
file_put_contents("$base/res/main.js", $js);

echo json_encode(['ok' => true, 'n' => $n]);
