import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Hash gerado no startup — evita re-hash em cada requisição
let adminPasswordHash = null;

async function getAdminHash() {
  if (!adminPasswordHash) {
    adminPasswordHash = await bcrypt.hash(
      process.env.ADMIN_PASSWORD || 'Admin@123',
      10
    );
  }
  return adminPasswordHash;
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@minicrm.com';

    if (email.toLowerCase().trim() !== adminEmail.toLowerCase()) {
      // Delay para dificultar ataques de timing
      await new Promise((r) => setTimeout(r, 300));
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const hash = await getAdminHash();
    const valid = await bcrypt.compare(password, hash);

    if (!valid) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const token = jwt.sign(
      { email: adminEmail, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      token,
      user: { email: adminEmail, role: 'admin' },
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Erro interno ao processar login.' });
  }
});

// GET /api/auth/me — valida token e retorna dados do usuário
router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }
  try {
    const decoded = jwt.verify(
      authHeader.split(' ')[1],
      process.env.JWT_SECRET
    );
    res.json({ user: { email: decoded.email, role: decoded.role } });
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
});

export default router;
