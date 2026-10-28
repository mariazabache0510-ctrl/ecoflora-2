<?php
require_once __DIR__ . '/config/conexion.php';
include __DIR__ . '/includes/header.php';

$destacadas = $conexion->query("SELECT p.*, c.nombre as categoria FROM plantas p JOIN categorias c ON p.id_categoria = c.id_categoria WHERE p.destacada = 1 LIMIT 6");
$categorias = $conexion->query("SELECT * FROM categorias LIMIT 5");
?>

<section class="hero-ecoflora animate-fade-in">
    <div class="container">
        <h1>Lleva la naturaleza a tu hogar</h1>
        <p class="lead mb-4">Plantas seleccionadas, domicilios seguros y asesoría personalizada</p>
        <a href="<?php echo BASE_URL; ?>/catalogo.php" class="btn btn-ecoflora btn-lg me-2"><i class="bi bi-grid me-2"></i>Ver catálogo</a>
        <a href="<?php echo BASE_URL; ?>/nosotros.php" class="btn btn-outline-light btn-lg">Conócenos</a>
    </div>
</section>

<div class="container my-5">
    <h2 class="text-center mb-4 fw-bold" style="color: var(--verde-oscuro);"><i class="bi bi-collection me-2"></i>Nuestras categorías</h2>
    <div class="row g-4 mb-5">
        <?php while($cat = $categorias->fetch_assoc()): ?>
        <div class="col-6 col-md-4 col-lg-2">
            <a href="<?php echo BASE_URL; ?>/catalogo.php?categoria=<?php echo $cat['id_categoria']; ?>" class="text-decoration-none">
                <div class="card h-100 text-center p-3 border-0 shadow-sm" style="border-radius: 15px;">
                    <div class="card-body">
                        <i class="bi <?php echo $cat['icono']; ?> fs-1 mb-2" style="color: var(--verde-medio);"></i>
                        <h6 class="card-title text-dark"><?php echo $cat['nombre']; ?></h6>
                    </div>
                </div>
            </a>
        </div>
        <?php endwhile; ?>
    </div>

    <h2 class="text-center mb-4 fw-bold" style="color: var(--verde-oscuro);"><i class="bi bi-stars me-2"></i>Plantas destacadas</h2>
    <div class="row g-4">
        <?php while($planta = $destacadas->fetch_assoc()): ?>
        <div class="col-md-6 col-lg-4">
            <div class="card card-planta h-100">
                <div style="overflow: hidden; height: 250px;">
                    <img src="https://placehold.co/600x400/2d6a4f/ffffff?text=<?php echo urlencode($planta['nombre']); ?>" class="card-img-top w-100 h-100" alt="<?php echo $planta['nombre']; ?>" style="object-fit: cover;">
                </div>
                <div class="card-body d-flex flex-column">
                    <span class="badge-categoria mb-2 align-self-start"><?php echo $planta['categoria']; ?></span>
                    <h5 class="card-title fw-bold"><?php echo $planta['nombre']; ?></h5>
                    <p class="card-text text-muted small flex-grow-1"><?php echo substr($planta['descripcion'], 0, 100); ?>...</p>
                    <div class="d-flex justify-content-between align-items-center mt-3">
                        <span class="precio-planta">$<?php echo number_format($planta['precio'], 0, ',', '.'); ?></span>
                        <a href="<?php echo BASE_URL; ?>/planta.php?id=<?php echo $planta['id_planta']; ?>" class="btn btn-ecoflora btn-sm">Ver más</a>
                    </div>
                </div>
            </div>
        </div>
        <?php endwhile; ?>
    </div>
</div>

<?php include __DIR__ . '/includes/footer.php'; ?>
