<?php
session_start();
require_once __DIR__ . '/../config/conexion.php';
if (!isset($_SESSION['id_usuario']) || $_SESSION['rol'] !== 'admin') {
    header("Location: " . BASE_URL . "/index.php?error=Acceso no autorizado");
    exit();
}
$id_usuario = isset($_GET['id']) ? intval($_GET['id']) : 0;
if ($id_usuario == $_SESSION['id_usuario']) {
    header("Location: " . BASE_URL . "/admin/usuarios.php?error=No puedes eliminar tu propia cuenta");
    exit();
}
$conexion->query("DELETE FROM carrito WHERE id_usuario = $id_usuario");
$conexion->query("DELETE FROM historial_navegacion WHERE id_usuario = $id_usuario");
$pedidos = $conexion->query("SELECT id_pedido FROM pedidos WHERE id_usuario = $id_usuario");
while($p = $pedidos->fetch_assoc()) {
    $conexion->query("DELETE FROM pedido_detalle WHERE id_pedido = {$p['id_pedido']}");
}
$conexion->query("DELETE FROM pedidos WHERE id_usuario = $id_usuario");
$stmt = $conexion->prepare("DELETE FROM usuarios WHERE id_usuario = ?");
$stmt->bind_param("i", $id_usuario);
if ($stmt->execute()) header("Location: " . BASE_URL . "/admin/usuarios.php?eliminado=1");
else header("Location: " . BASE_URL . "/admin/usuarios.php?error=No se pudo eliminar");
exit();
?>
