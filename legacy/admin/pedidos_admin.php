<?php
require_once __DIR__ . '/../config/conexion.php';
if (!isset($_SESSION['id_usuario']) || $_SESSION['rol'] !== 'admin') {
    header("Location: " . BASE_URL . "/index.php?error=Acceso no autorizado");
    exit();
}
if (isset($_POST['cambiar_estado'])) {
    $id = intval($_POST['id_pedido']);
    $estado = $_POST['estado'];
    $stmt = $conexion->prepare("UPDATE pedidos SET estado = ? WHERE id_pedido = ?");
    $stmt->bind_param("si", $estado, $id);
    $stmt->execute();
    header("Location: " . BASE_URL . "/admin/pedidos_admin.php");
    exit();
}
$pedidos = $conexion->query("SELECT p.*, u.nombre as cliente, u.email, u.telefono FROM pedidos p JOIN usuarios u ON p.id_usuario = u.id_usuario ORDER BY p.fecha_pedido DESC");
include __DIR__ . '/../includes/header.php';
?>

<div class="container my-5">
    <h2 class="fw-bold mb-4" style="color: var(--verde-oscuro);"><i class="bi bi-truck me-2"></i>Pedidos / Domicilios</h2>
    <div class="card shadow-sm border-0" style="border-radius: 15px;">
        <div class="table-responsive">
            <table class="table table-hover mb-0 align-middle">
                <thead class="table-ecoflora"><tr><th>#</th><th>Cliente</th><th>Total</th><th>Estado</th><th>Fecha</th><th>Acción</th></tr></thead>
                <tbody>
                    <?php $colores = ['pendiente'=>'warning','confirmado'=>'info','en_camino'=>'primary','entregado'=>'success','cancelado'=>'danger']; while($p = $pedidos->fetch_assoc()): ?>
                    <tr>
                        <td><?php echo $p['id_pedido']; ?></td>
                        <td><?php echo $p['cliente']; ?><br><small class="text-muted"><?php echo $p['email']; ?></small></td>
                        <td>$<?php echo number_format($p['total'], 0, ',', '.'); ?></td>
                        <td><span class="badge bg-<?php echo $colores[$p['estado']]; ?>"><?php echo $p['estado']; ?></span></td>
                        <td><?php echo date('d/m/Y H:i', strtotime($p['fecha_pedido'])); ?></td>
                        <td>
                            <form method="POST" class="d-flex gap-2">
                                <input type="hidden" name="id_pedido" value="<?php echo $p['id_pedido']; ?>">
                                <select name="estado" class="form-select form-select-sm" style="width: 130px;">
                                    <?php foreach(array_keys($colores) as $est): ?><option value="<?php echo $est; ?>" <?php echo ($p['estado']==$est)?'selected':''; ?>><?php echo ucfirst($est); ?></option><?php endforeach; ?>
                                </select>
                                <button type="submit" name="cambiar_estado" class="btn btn-sm btn-ecoflora">Actualizar</button>
                            </form>
                        </td>
                    </tr>
                    <?php endwhile; ?>
                </tbody>
            </table>
        </div>
    </div>
    <a href="<?php echo BASE_URL; ?>/admin/panel_admin.php" class="btn btn-secondary mt-3"><i class="bi bi-arrow-left me-1"></i>Volver al panel</a>
</div>

<?php include __DIR__ . '/../includes/footer.php'; ?>
