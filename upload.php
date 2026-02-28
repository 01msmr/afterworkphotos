<?php
require __DIR__ . '/secret.php';
define('SECRET', UPLOAD_SECRET);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') exit('no');
if (($_POST['token'] ?? '') !== SECRET) { http_response_code(403); exit('forbidden'); }

$base = __DIR__;

$js = file_get_contents("$base/res/main.js");
if (!preg_match('/const PHOTO_COUNT = (\d+)/', $js, $m)) {
    http_response_code(500); exit('could not parse PHOTO_COUNT');
}
$n = (int)$m[1] + 1;

$raw = $_POST['photo'] ?? '';
$raw = preg_replace('/^data:[^;]+;base64,/', '', $raw);
$data = base64_decode($raw);
if (strlen($data) < 100) { http_response_code(400); exit('no photo data'); }

file_put_contents("$base/img/{$n}.jpg", $data);

$js = preg_replace('/const PHOTO_COUNT = \d+/', "const PHOTO_COUNT = {$n}", $js);
file_put_contents("$base/res/main.js", $js);

echo json_encode(['ok' => true, 'n' => $n]);
