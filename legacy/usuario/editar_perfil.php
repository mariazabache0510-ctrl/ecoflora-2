<?php
require_once __DIR__ . '/../config/conexion.php';
if (!isset($_SESSION['id_usuario']) || $_SESSION['rol'] !== 'cliente') {
    header("Location: " . BASE_URL . "/index.php?error=Debes iniciar sesión");
    exit();
}
$id_usuario = $_SESSION['id_usuario'];
$stmt = $conexion->prepare("SELECT nombre, usuario, email, telefono, direccion, ciudad FROM usuarios WHERE id_usuario = ?");
$stmt->bind_param("i", $id_usuario);
$stmt->execute();
$datos = $stmt->get_result()->fetch_assoc();
include __DIR__ . '/../includes/header.php';
?>

<div class="container my-5">
    <div class="row justify-content-center">
        <div class="col-md-7">
            <div class="card shadow border-0" style="border-radius: 20px;">
                <div class="card-header bg-primary text-white text-center" style="border-radius: 20px 20px 0 0;"><h4 class="mb-0">Modificar mis datos</h4></div>
                <div class="card-body p-4">
                    <?php if(isset($_GET['actualizado'])): ?><div class="alert alert-success">Tus datos fueron actualizados correctamente.</div><?php endif; ?>
                    <?php if(isset($_GET['error'])): ?><div class="alert alert-danger"><?php echo htmlspecialchars($_GET['error']); ?></div><?php endif; ?>
                    <form action="<?php echo BASE_URL; ?>/usuario/actualizar_perfil.php" method="POST" onsubmit="return validarPerfil();">
                        <div class="mb-3"><label class="form-label">Nombre completo</label><input type="text" name="nombre" id="nombre" class="form-control" value="<?php echo htmlspecialchars($datos['nombre']); ?>" required></div>
                        <div class="mb-3"><label class="form-label">Usuario</label><input type="text" class="form-control" value="<?php echo htmlspecialchars($datos['usuario']); ?>" disabled><div class="form-text">El usuario no se puede modificar.</div></div>
                        <div class="mb-3"><label class="form-label">Email</label><input type="email" name="email" id="email" class="form-control" value="<?php echo htmlspecialchars($datos['email']); ?>" required></div>
                        <div class="mb-3"><label class="form-label">Teléfono</label><input type="text" name="telefono" class="form-control" value="<?php echo htmlspecialchars($datos['telefono']);"></div>
                        <div class="mb-3"><label class="form-label">Dirección</label><input type="text" name="direccion" class="form-control" value="<?php echo htmlspecialchars($datos['direccion']);"></div>
                        <div class="mb-3"><label class="form-label">Ciudad</label><input type="text" name="ciudad" class="form-control" value="<?php echo htmlspecialchars($datos['ciudad']);"></div>
                        <div class="d-grid gap-2"><button type="submit" class="btn btn-primary">Guardar cambios</button><a href="<?php echo BASE_URL; ?>/usuario/panel.php" class="btn btn-secondary">Volver al panel</a></div>
                    </form>
                </div>
            </div>
        </div>
    </div>
</div>

<script>function validarPerfil(){let n=document.getElementById("nombre"),e=document.getElementById("email"),v=true;n.classList.remove("is-invalid");e.classList.remove("is-invalid");if(n.value.trim()===""){n.classList.add("is-invalid");v=false;}if(e.value.trim()===""){e.classList.add("is-invalid");v=false;}return v;}</script>

<?php include __DIR__ . '/../includes/footer.php'; ?>
