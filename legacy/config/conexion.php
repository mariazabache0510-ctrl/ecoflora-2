<?php
$host = "localhost";
$usuario = "root";
$password = "";
$base_datos = "ecoflora_db";

$conexion = new mysqli($host, $usuario, $password, $base_datos);

if ($conexion->connect_error) {
    die("Error de conexión: " . $conexion->connect_error);
}

$conexion->set_charset("utf8mb4");

$protocolo = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? "https://" : "http://";
$host_name = $_SERVER['HTTP_HOST'];
define('BASE_URL', $protocolo . $host_name . '/ecoflora');

function registrarHistorial($conexion, $pagina, $url) {
    if (session_status() === PHP_SESSION_NONE) session_start();
    $id_usuario = isset($_SESSION['id_usuario']) ? $_SESSION['id_usuario'] : null;
    $ip = $_SERVER['REMOTE_ADDR'];
    $stmt = $conexion->prepare("INSERT INTO historial_navegacion (id_usuario, ip_address, pagina, url) VALUES (?, ?, ?, ?)");
    $stmt->bind_param("isss", $id_usuario, $ip, $pagina, $url);
    $stmt->execute();
    $stmt->close();
}
?>
