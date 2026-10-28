<?php
require_once __DIR__ . '/../config/conexion.php';
if (!isset($_SESSION['id_usuario']) || $_SESSION['rol'] !== 'cliente') {
    header("Location: " . BASE_URL . "/index.php?error=Debes iniciar sesión");
    exit();
}
include __DIR__ . '/../includes/header.php';
$stmt = $conexion->prepare("SELECT * FROM historial_navegacion WHERE id_usuario = ? ORDER BY fecha_visita DESC LIMIT 50");
$stmt->bind_param("i", $_SESSION['id_usuario']);
$stmt->execute();
$historial = $stmt->get_result();
?>

<div class="container my-5">
    <h2 class="fw-bold mb-4" style="color: var(--verde-oscuro);"><i class="bi bi-clock-history me-2"></i>Historial de Navegación</h2>
    <div class="card shadow-sm border-0" style="border-radius: 15px;">
        <div class="table-responsive">
            <table class="table table-hover mb-0">
                <thead class="table-ecoflora"><tr><th>Página</th><th>URL</th><th>Fecha y hora</th></tr></thead>
                <tbody>
                    <?php while($h = $historial->fetch_assoc()): ?>
                    <tr><td><span class="badge bg-light text-dark border"><?php echo ucfirst($h['pagina']); ?></span></td><td><small class="text-muted"><?php echo $h['url']; ?></small></td><td><?php echo date('d/m/Y H:i:s', strtotime($h['fecha_visita'])); ?></td></tr>
                    <?php endwhile; ?>
                </tbody>
            </table>
        </div>
    </div>
    <a href="<?php echo BASE_URL; ?>/usuario/panel.php" class="btn btn-secondary mt-3"><i class="bi bi-arrow-left me-1"></i>Volver al panel</a>
</div>

<?php include __DIR__ . '/../includes/footer.php'; ?>
