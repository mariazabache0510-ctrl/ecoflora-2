<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
require_once __DIR__ . '/../config/conexion.php';

$items_carrito = 0;
if (isset($_SESSION['id_usuario'])) {
    $stmt = $conexion->prepare("SELECT SUM(cantidad) as total FROM carrito WHERE id_usuario = ?");
    $stmt->bind_param("i", $_SESSION['id_usuario']);
    $stmt->execute();
    $res = $stmt->get_result()->fetch_assoc();
    $items_carrito = $res['total'] ?? 0;
} elseif (isset($_SESSION['sesion_carrito'])) {
    $items_carrito = array_sum($_SESSION['sesion_carrito']);
}

if (!isset($_SERVER['HTTP_X_REQUESTED_WITH'])) {
    $pagina_actual = basename($_SERVER['PHP_SELF'], '.php');
    $url_actual = $_SERVER['REQUEST_URI'];
    registrarHistorial($conexion, $pagina_actual, $url_actual);
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>EcoFlora - Vivero Online</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
    <link rel="stylesheet" href="<?php echo BASE_URL; ?>/css/estilos.css">
</head>
<body>

<nav class="navbar navbar-expand-lg navbar-dark navbar-ecoflora sticky-top">
    <div class="container">
        <a class="navbar-brand" href="<?php echo BASE_URL; ?>/index.php">
            <i class="bi bi-flower1 me-2"></i>EcoFlora
        </a>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#menuEco">
            <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse" id="menuEco">
            <ul class="navbar-nav ms-auto align-items-center">
                <li class="nav-item"><a class="nav-link" href="<?php echo BASE_URL; ?>/index.php">Inicio</a></li>
                <li class="nav-item"><a class="nav-link" href="<?php echo BASE_URL; ?>/catalogo.php">Catálogo</a></li>
                <li class="nav-item"><a class="nav-link" href="<?php echo BASE_URL; ?>/nosotros.php">Nosotros</a></li>
                <li class="nav-item"><a class="nav-link" href="<?php echo BASE_URL; ?>/contacto.php">Contacto</a></li>
                <li class="nav-item ms-lg-3">
                    <a class="nav-link carrito-badge" href="<?php echo BASE_URL; ?>/carrito.php">
                        <i class="bi bi-cart3 fs-5"></i>
                        <?php if($items_carrito > 0): ?>
                            <span class="carrito-numero"><?php echo $items_carrito; ?></span>
                        <?php endif; ?>
                    </a>
                </li>
                <?php if(isset($_SESSION['id_usuario'])): ?>
                    <?php if($_SESSION['rol'] === 'admin'): ?>
                        <li class="nav-item"><a class="nav-link" href="<?php echo BASE_URL; ?>/admin/panel_admin.php"><i class="bi bi-speedometer2 me-1"></i>Panel Admin</a></li>
                        <li class="nav-item"><a class="nav-link" href="<?php echo BASE_URL; ?>/admin/usuarios.php"><i class="bi bi-people me-1"></i>Usuarios</a></li>
                    <?php else: ?>
                        <li class="nav-item"><a class="nav-link" href="<?php echo BASE_URL; ?>/usuario/panel.php"><i class="bi bi-person me-1"></i>Mi Panel</a></li>
                        <li class="nav-item"><a class="nav-link" href="<?php echo BASE_URL; ?>/usuario/domicilios.php"><i class="bi bi-truck me-1"></i>Mis Pedidos</a></li>
                        <li class="nav-item"><a class="nav-link" href="<?php echo BASE_URL; ?>/usuario/historial.php"><i class="bi bi-clock-history me-1"></i>Historial</a></li>
                    <?php endif; ?>
                    <li class="nav-item ms-lg-2">
                        <a class="btn btn-outline-light btn-sm" href="<?php echo BASE_URL; ?>/logout.php"><i class="bi bi-box-arrow-right me-1"></i>Salir</a>
                    </li>
                <?php else: ?>
                    <li class="nav-item ms-lg-2">
                        <a class="btn btn-outline-light btn-sm" href="<?php echo BASE_URL; ?>/login.php">Ingresar</a>
                    </li>
                <?php endif; ?>
            </ul>
        </div>
    </div>
</nav>

<main>
