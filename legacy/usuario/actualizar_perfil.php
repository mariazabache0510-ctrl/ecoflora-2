<?php
session_start();
require_once __DIR__ . '/../config/conexion.php';
if (!isset($_SESSION['id_usuario']) || $_SESSION['rol'] !== 'cliente') {
    header("Location: " . BASE_URL . "/index.php?error=Debes iniciar sesión");
    exit();
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header("Location: " . BASE_URL . "/usuario/editar_perfil.php");
    exit();
}
$id_usuario = $_SESSION['id_usuario'];
$nombre = trim($_POST['nombre']);
$email = trim($_POST['email']);
$telefono = trim($_POST['telefono']);
$direccion = trim($_POST['direccion']);
$ciudad = trim($_POST['ciudad']);
if (empty($nombre) || empty($email)) {
    header("Location: " . BASE_URL . "/usuario/editar_perfil.php?error=Nombre y email son obligatorios");
    exit();
}
$check = $conexion->prepare("SELECT id_usuario FROM usuarios WHERE email = ? AND id_usuario <> ?");
$check->bind_param("si", $email, $id_usuario);
$check->execute();
if ($check->get_result()->num_rows > 0) {
    header("Location: " . BASE_URL . "/usuario/editar_perfil.php?error=El email ya está registrado por otro usuario");
    exit();
}
$sql = $conexion->prepare("UPDATE usuarios SET nombre=?, email=?, telefono=?, direccion=?, ciudad=? WHERE id_usuario=?");
$sql->bind_param("sssssi", $nombre, $email, $telefono, $direccion, $ciudad, $id_usuario);
if ($sql->execute()) {
    $_SESSION['nombre'] = $nombre;
    header("Location: " . BASE_URL . "/usuario/editar_perfil.php?actualizado=1");
} else {
    header("Location: " . BASE_URL . "/usuario/editar_perfil.php?error=No fue posible actualizar");
}
exit();
?>
