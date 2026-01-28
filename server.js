const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors()); 
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',      
    password: 'root',      
    database: 'newdemo_db'
});

db.connect(err => {
    if (err) {
        console.error('Database connection failed: ' + err.stack);
        return;
    }
    console.log('Connected to newdemo_db');
});


app.post('/check-email', (req, res) => {
    let email = req.body.email;
    if (!email) {
        return res.status(400).json({ exists: false, error: "No email provided" });
    }
    email = email.trim(); 

    const sql = "SELECT * FROM energies_demoo WHERE LOWER(empmail) = LOWER(?)";
    
    db.execute(sql, [email], (err, results) => {
        if (err) {
            console.error("Database Error:", err); 
            return res.status(500).json({ error: "Database query failed" });
        }

        console.log(`Searching for: [${email}] | Found: ${results.length} matches`);

        if (results.length > 0) {
            res.json({ exists: true });
        } else {
            res.json({ exists: false });
        }
    });
});
app.listen(3000, () => console.log('Server running on http://localhost:3000'));