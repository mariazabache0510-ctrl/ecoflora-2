<?php
require_once __DIR__ . '/../config/conexion.php';
if (!isset($_SESSION['id_usuario']) || $_SESSION['rol'] !== 'admin') {
    header("Location: " . BASE_URL . "/index.php?error=Acceso no autorizado");
    exit();
}
include __DIR__ . '/../includes/header.php';
$usuarios = $conexion->query("SELECT id_usuario, nombre, usuario, email, telefono, direccion, ciudad, rol, fecha_registro FROM usuarios ORDER BY fecha_registro DESC");
?>

<div class="container my-5">
    <div class="card shadow border-0" style="border-radius: 20px;">
        <div class="card-header bg-dark text-white" style="border-radius: 20px 20px 0 0;">
            <h4 class="mb-0"><i class="bi bi-people me-2"></i>Administración de Usuarios</h4>
        </div>
        <div class="card-body p-4">
            <?php if(isset($_GET['eliminado'])): ?><div class="alert alert-success">Usuario eliminado correctamente.</div><?php endif; ?>
            <?php if(isset($_GET['actualizado'])): ?><div class="alert alert-success">Usuario actualizado correctamente.</div><?php endif; ?>
            <div class="table-responsive">
                <table class="table table-bordered table-striped align-middle">
                    <thead class="table-dark"><tr><th>Nombre</th><th>Usuario</th><th>Email</th><th>Teléfono</th><th>Ciudad</th><th>Rol</th><th style="width: 180px;">Acciones</th></tr></thead>
                    <tbody>
                        <?php while($u = $usuarios->fetch_assoc()): ?>
                        <tr>
                            <td><?php echo htmlspecialchars($u['nombre']); ?></td>
                            <td><?php echo htmlspecialchars($u['usuario']); ?></td>
                            <td><?php echo htmlspecialchars($u['email']); ?></td>
                            <td><?php echo htmlspecialchars($u['telefono']); ?></td>
                            <td><?php echo htmlspecialchars($u['ciudad']); ?></td>
                            <td><span class="badge bg-<?php echo ($u['rol']=='admin')?'danger':'info'; ?>"><?php echo $u['rol']; ?></span></td>
                            <td>
                                <a href="<?php echo BASE_URL; ?>/admin/editar_usuario.php?id=<?php echo $u['id_usuario']; ?>" class="btn btn-warning btn-sm"><i class="bi bi-pencil"></i> Editar</a>
                                <?php if($u['id_usuario'] != $_SESSION['id_usuario']): ?>
                                <a href="<?php echo BASE_URL; ?>/admin/eliminar_usuario.php?id=<?php echo $u['id_usuario']; ?>" class="btn btn-danger btn-sm" onclick="return confirm('¿Seguro que deseas eliminar este usuario?');"><i class="bi bi-trash"></i> Eliminar</a>
                                <?php endif; ?>
                            </td>
                        </tr>
                        <?php endwhile; ?>
                    </tbody>
                </table>
            </div>
            <a href="<?php echo BASE_URL; ?>/admin/panel_admin.php" class="btn btn-secondary mt-3"><i class="bi bi-arrow-left me-1"></i>Volver al panel</a>
        </div>
    </div>
</div>

<?php include __DIR__ . '/../includes/footer.php'; ?>
