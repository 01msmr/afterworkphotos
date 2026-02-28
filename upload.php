<?php
define('SECRET', '7fea306a938a22aa3b3de215c551eaff');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') exit('no');
if (($_POST['token'] ?? '') !== SECRET) { http_response_code(403); exit('forbidden'); }

$js = file_get_contents('res/main.js');
if (!preg_match('/const PHOTO_COUNT = (\d+)/', $js, $m)) {
    http_response_code(500); exit('could not parse PHOTO_COUNT');
}
$n = (int)$m[1] + 1;

$data = base64_decode($_POST['photo'] ?? '');
if (strlen($data) < 100) { http_response_code(400); exit('no photo data'); }

file_put_contents("img/{$n}.jpg", $data);

$js = preg_replace('/const PHOTO_COUNT = \d+/', "const PHOTO_COUNT = {$n}", $js);
file_put_contents('res/main.js', $js);

echo json_encode(['ok' => true, 'n' => $n]);
