<?php
require_once __DIR__ . '/../config/conexion.php';
if (!isset($_SESSION['id_usuario']) || $_SESSION['rol'] !== 'cliente') {
    header("Location: " . BASE_URL . "/index.php?error=Debes iniciar sesión");
    exit();
}
include __DIR__ . '/../includes/header.php';
?>

<div class="container my-5">
    <div class="card shadow border-0" style="border-radius: 20px;">
        <div class="card-header bg-primary text-white" style="border-radius: 20px 20px 0 0;"><h4 class="mb-0"><i class="bi bi-person-circle me-2"></i>Panel del Cliente</h4></div>
        <div class="card-body p-4">
            <h5 class="mb-3">Bienvenido(a), <?php echo htmlspecialchars($_SESSION['nombre']); ?></h5>
            <p class="text-muted">Desde aquí puedes gestionar tus pedidos, editar tus datos y ver tu historial de navegación.</p>
            <div class="d-flex gap-3 flex-wrap mt-4">
                <a href="<?php echo BASE_URL; ?>/catalogo.php" class="btn btn-ecoflora"><i class="bi bi-shop me-2"></i>Ir a comprar</a>
                <a href="<?php echo BASE_URL; ?>/usuario/domicilios.php" class="btn btn-outline-ecoflora"><i class="bi bi-truck me-2"></i>Mis Pedidos</a>
                <a href="<?php echo BASE_URL; ?>/usuario/editar_perfil.php" class="btn btn-secondary"><i class="bi bi-pencil me-2"></i>Editar mis datos</a>
                <a href="<?php echo BASE_URL; ?>/usuario/historial.php" class="btn btn-info text-white"><i class="bi bi-clock-history me-2"></i>Historial</a>
                <a href="<?php echo BASE_URL; ?>/logout.php" class="btn btn-danger"><i class="bi bi-box-arrow-right me-2"></i>Cerrar sesión</a>
            </div>
        </div>
    </div>
</div>

<?php include __DIR__ . '/../includes/footer.php'; ?>
