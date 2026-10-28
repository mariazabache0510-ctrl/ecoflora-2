<?php
require_once __DIR__ . '/../config/conexion.php';
if (!isset($_SESSION['id_usuario']) || $_SESSION['rol'] !== 'admin') {
    header("Location: " . BASE_URL . "/index.php?error=Acceso no autorizado");
    exit();
}
$total_plantas = $conexion->query("SELECT COUNT(*) as c FROM plantas")->fetch_assoc()['c'];
$total_pedidos = $conexion->query("SELECT COUNT(*) as c FROM pedidos")->fetch_assoc()['c'];
$total_usuarios = $conexion->query("SELECT COUNT(*) as c FROM usuarios WHERE rol = 'cliente'")->fetch_assoc()['c'];
$pendientes = $conexion->query("SELECT COUNT(*) as c FROM pedidos WHERE estado = 'pendiente'")->fetch_assoc()['c'];
include __DIR__ . '/../includes/header.php';
?>

<div class="container my-5">
    <div class="card shadow border-0" style="border-radius: 20px;">
        <div class="card-header bg-dark text-white" style="border-radius: 20px 20px 0 0;">
            <h4 class="mb-0"><i class="bi bi-speedometer2 me-2"></i>Panel de Administración</h4>
        </div>
        <div class="card-body p-4">
            <h5 class="mb-3">Bienvenido(a), <?php echo htmlspecialchars($_SESSION['nombre']); ?></h5>
            <p class="text-muted">Desde aquí puedes gestionar usuarios, pedidos y el inventario de plantas.</p>
            <div class="row g-4 mb-4">
                <div class="col-md-3"><div class="card text-center p-3 border-0 shadow-sm"><h3 class="fw-bold text-success"><?php echo $total_plantas; ?></h3><small class="text-muted text-uppercase fw-bold">Plantas</small></div></div>
                <div class="col-md-3"><div class="card text-center p-3 border-0 shadow-sm"><h3 class="fw-bold text-warning"><?php echo $total_pedidos; ?></h3><small class="text-muted text-uppercase fw-bold">Pedidos</small></div></div>
                <div class="col-md-3"><div class="card text-center p-3 border-0 shadow-sm"><h3 class="fw-bold text-primary"><?php echo $total_usuarios; ?></h3><small class="text-muted text-uppercase fw-bold">Clientes</small></div></div>
                <div class="col-md-3"><div class="card text-center p-3 border-0 shadow-sm"><h3 class="fw-bold text-danger"><?php echo $pendientes; ?></h3><small class="text-muted text-uppercase fw-bold">Pendientes</small></div></div>
            </div>
            <div class="d-flex gap-3 flex-wrap">
                <a href="<?php echo BASE_URL; ?>/admin/usuarios.php" class="btn btn-primary"><i class="bi bi-people me-2"></i>Gestionar Usuarios</a>
                <a href="<?php echo BASE_URL; ?>/admin/pedidos_admin.php" class="btn btn-success"><i class="bi bi-truck me-2"></i>Ver Pedidos / Domicilios</a>
                <a href="<?php echo BASE_URL; ?>/index.php" class="btn btn-outline-secondary"><i class="bi bi-shop me-2"></i>Ver tienda</a>
                <a href="<?php echo BASE_URL; ?>/logout.php" class="btn btn-danger"><i class="bi bi-box-arrow-right me-2"></i>Cerrar sesión</a>
            </div>
        </div>
    </div>
</div>

<?php include __DIR__ . '/../includes/footer.php'; ?>
