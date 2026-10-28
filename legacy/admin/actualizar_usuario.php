<?php
session_start();
require_once __DIR__ . '/../config/conexion.php';
if (!isset($_SESSION['id_usuario']) || $_SESSION['rol'] !== 'admin') {
    header("Location: " . BASE_URL . "/index.php?error=Acceso no autorizado");
    exit();
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header("Location: " . BASE_URL . "/admin/usuarios.php");
    exit();
}
$id_usuario = intval($_POST['id_usuario']);
$nombre = trim($_POST['nombre']);
$usuario = trim($_POST['usuario']);
$email = trim($_POST['email']);
$telefono = trim($_POST['telefono']);
$direccion = trim($_POST['direccion']);
$ciudad = trim($_POST['ciudad']);
$rol = $_POST['rol'];
$password = trim($_POST['password']);

if (!empty($password)) {
    $password_hash = password_hash($password, PASSWORD_DEFAULT);
    $sql = $conexion->prepare("UPDATE usuarios SET nombre=?, usuario=?, email=?, telefono=?, direccion=?, ciudad=?, rol=?, password=? WHERE id_usuario=?");
    $sql->bind_param("ssssssssi", $nombre, $usuario, $email, $telefono, $direccion, $ciudad, $rol, $password_hash, $id_usuario);
} else {
    $sql = $conexion->prepare("UPDATE usuarios SET nombre=?, usuario=?, email=?, telefono=?, direccion=?, ciudad=?, rol=? WHERE id_usuario=?");
    $sql->bind_param("sssssssi", $nombre, $usuario, $email, $telefono, $direccion, $ciudad, $rol, $id_usuario);
}
if ($sql->execute()) header("Location: " . BASE_URL . "/admin/usuarios.php?actualizado=1");
else header("Location: " . BASE_URL . "/admin/usuarios.php?error=No se pudo actualizar");
exit();
?>
