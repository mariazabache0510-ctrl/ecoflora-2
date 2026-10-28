<?php
require_once __DIR__ . '/../config/conexion.php';
if (!isset($_SESSION['id_usuario']) || $_SESSION['rol'] !== 'cliente') {
    header("Location: " . BASE_URL . "/index.php?error=Debes iniciar sesión");
    exit();
}
include __DIR__ . '/../includes/header.php';
$stmt = $conexion->prepare("SELECT * FROM pedidos WHERE id_usuario = ? ORDER BY fecha_pedido DESC");
$stmt->bind_param("i", $_SESSION['id_usuario']);
$stmt->execute();
$pedidos = $stmt->get_result();
?>

<div class="container my-5">
    <h2 class="fw-bold mb-4" style="color: var(--verde-oscuro);"><i class="bi bi-truck me-2"></i>Mis Domicilios</h2>
    <?php if(isset($_GET['exito'])): ?><div class="alert alert-success"><i class="bi bi-check-circle me-2"></i>¡Pedido realizado con éxito!</div><?php endif; ?>
    <?php if($pedidos->num_rows === 0): ?>
        <div class="text-center py-5"><i class="bi bi-box-seam fs-1 text-muted"></i><p class="mt-3 text-muted">No tienes pedidos aún.</p><a href="<?php echo BASE_URL; ?>/catalogo.php" class="btn btn-ecoflora">Ir a comprar</a></div>
    <?php else: ?>
        <div class="row g-4">
            <?php while($p = $pedidos->fetch_assoc()):
                $det = $conexion->query("SELECT d.*, pl.nombre FROM pedido_detalle d JOIN plantas pl ON d.id_planta = pl.id_planta WHERE d.id_pedido = {$p['id_pedido']}");
                $colores = ['pendiente'=>'warning','confirmado'=>'info','en_camino'=>'primary','entregado'=>'success','cancelado'=>'danger'];
            ?>
            <div class="col-12">
                <div class="card shadow-sm border-0" style="border-radius: 15px;">
                    <div class="card-header bg-white d-flex justify-content-between align-items-center">
                        <div><small class="text-muted">Pedido #<?php echo $p['id_pedido']; ?></small><span class="ms-2 badge bg-<?php echo $colores[$p['estado']]; ?>"><?php echo $p['estado']; ?></span></div>
                        <small class="text-muted"><?php echo date('d/m/Y H:i', strtotime($p['fecha_pedido'])); ?></small>
                    </div>
                    <div class="card-body">
                        <p class="mb-1"><strong>Envío a:</strong> <?php echo $p['direccion_envio']; ?>, <?php echo $p['ciudad_envio']; ?></p>
                        <p class="mb-3"><i class="bi bi-telephone me-1"></i><?php echo $p['telefono_contacto']; ?></p>
                        <ul class="list-group list-group-flush">
                            <?php while($d = $det->fetch_assoc()): ?>
                            <li class="list-group-item px-0 d-flex justify-content-between"><span><?php echo $d['nombre']; ?> x<?php echo $d['cantidad']; ?></span><span>$<?php echo number_format($d['precio_unitario'] * $d['cantidad'], 0, ',', '.'); ?></span></li>
                            <?php endwhile; ?>
                        </ul>
                        <div class="text-end mt-3"><strong class="fs-5" style="color: var(--verde-oscuro);">Total: $<?php echo number_format($p['total'], 0, ',', '.'); ?></strong></div>
                    </div>
                </div>
            </div>
            <?php endwhile; ?>
        </div>
    <?php endif; ?>
</div>

<?php include __DIR__ . '/../includes/footer.php'; ?>
