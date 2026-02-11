const express = require('express');
const mysql = require('mysql2');
const nodemailer = require('nodemailer');
const cors = require('cors');
const xlsx = require('xlsx');
const fs = require('fs');

const workbook = xlsx.readFile('Book1.xlsx');
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const sheetData = xlsx.utils.sheet_to_json(sheet);

const app = express();
const PORT = 3000;

app.use(express.static("public"));
app.use(cors());
app.use(express.json());

// MySQL connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'newdemo_db'
});

db.connect(err => {
    if (err) {
        console.log("DB CONNECTION FAILED:", err);
    } else {
        console.log("DB CONNECTED SUCCESSFULLY");
    }
});

// Excel to DB on Startup
sheetData.forEach(row => {
    const { empname, empid, empmail, location, dept, subdept, activeflag, managerid, position } = row;

    const sql = `
        INSERT INTO emp_details 
        (empname, empid, empmail, location, dept, subdept, activeflag, managerid, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        empname = VALUES(empname),
        empmail = VALUES(empmail),
        location = VALUES(location),
        dept = VALUES(dept),
        subdept = VALUES(subdept),
        activeflag = VALUES(activeflag),
        managerid = VALUES(managerid),
        position = VALUES(position);
    `;

    const values = [
        empname, empid, empmail, location,
        dept, subdept, activeflag, managerid, position
    ];

    db.query(sql, values);
});

// Nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'peddadasuryalalitha@gmail.com', 
        pass: 'melpoboctbvlohrw'              
    }
});

// REGISTER EMPLOYEE
app.post("/register", (req, res) => {
    const { empname, empid, empmail, location, dept, subdept, activeflag, managerid, position } = req.body;

    if (!empname || !empmail) {
        return res.json({ success: false, message: "Missing required fields" });
    }

    const insertSql = `
        INSERT INTO emp_details 
        (empname, empid, empmail, location, dept, subdept, activeflag, managerid, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(insertSql, [empname, empid, empmail, location, dept, subdept, activeflag, managerid, position], (err) => {
        if (err) {
            console.error("REGISTER ERROR:", err);

            if (err.code === "ER_DUP_ENTRY") {
                return res.json({
                    success: false,
                    message: "Email already exists"
                });
            }

            return res.json({
                success: false,
                message: "Registration failed. Check server."
            });
        }

        // Append to Excel
        const newRow = {
            empname,
            empid,
            empmail,
            location,
            dept,
            subdept,
            activeflag,
            managerid,
            position
        };

        sheetData.push(newRow);

        const newSheet = xlsx.utils.json_to_sheet(sheetData);
        const newWorkbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(newWorkbook, newSheet, "Sheet1");

        xlsx.writeFile(newWorkbook, "Book1.xlsx");

        res.json({ success: true });
    });
});

// SEND OTP
app.post('/send-otp', (req, res) => {
    const { email } = req.body;

    const checkSql =
        "SELECT empmail, activeflag FROM emp_details WHERE LOWER(empmail) = LOWER(?)";

    db.execute(checkSql, [email], (err, results) => {
        if (err) {
            return res.json({ success: false, message: "Database error" });
        }

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Email ID not found. Please contact admin."
            });
        }

        const activeflag = parseInt(results[0].activeflag);

        // 🔴 Pending
        if (activeflag === 2) {
            return res.json({
                success: false,
                message: "Your account is pending manager approval."
            });
        }

        // 🔴 Inactive
        if (activeflag === 0) {
            return res.json({
                success: false,
                message: "Your account is inactive."
            });
        }

        // 🟢 Only active users reach here
        const otp = Math.floor(1000 + Math.random() * 9000);
        const expiryTime = Date.now() + 5 * 60 * 1000;

        const insertOtpSql = `
            INSERT INTO otp_verification (empmail, otp, expires_at)
            VALUES (?, ?, ?)
        `;

        db.execute(insertOtpSql, [email, otp, expiryTime], (insertErr) => {
            if (insertErr) {
                return res.json({ success: false, message: "Failed to store OTP" });
            }

            res.json({ success: true, message: "OTP sent successfully" });

            const mailOptions = {
                from: 'peddadasuryalalitha@gmail.com',
                to: email,
                subject: 'Your OTP for Login',
                html: `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 520px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #2c3e50; margin-bottom: 10px;">Employee Portal Login</h2>
            <p style="font-size: 14px; color: #555;">
                Hi,
            </p>
            <p style="font-size: 14px; color: #555;">
                We received a request to sign in to your Employee Portal account.
            </p>

            <div style="text-align: center; margin: 25px 0;">
                <span style="font-size: 28px; letter-spacing: 4px; font-weight: bold; color: #1e88e5;">
                    ${otp}
                </span>
            </div>

            <p style="font-size: 14px; color: #555;">
                This OTP is valid for <b>5 minutes</b>. Please do not share this OTP with anyone for security reasons.
            </p>

            <p style="font-size: 13px; color: #777;">
                If you did not request this login, you can safely ignore this email.
            </p>

            <hr style="margin: 20px 0;">

            <p style="font-size: 12px; color: #999;">
                Regards,<br>
                <b>Employee Portal Team</b>
            </p>
        </div>
    `
            };

            transporter.sendMail(mailOptions)
                .catch(e => console.log("Mail Error:", e));
        });
    });
});

// VERIFY OTP
app.post('/verify-otp', (req, res) => {
    const { email, otp } = req.body;

    const sql = `
        SELECT id, otp, expires_at, used
        FROM otp_verification
        WHERE LOWER(empmail) = LOWER(?)
        ORDER BY created_at DESC
        LIMIT 1
    `;

    db.execute(sql, [email], (err, results) => {
        if (err || results.length === 0) {
            return res.json({ success: false, message: "OTP not found" });
        }

        const record = results[0];

        if (record.used) {
            return res.json({ success: false, message: "OTP already used" });
        }

        if (Date.now() > record.expires_at) {
            return res.json({ success: false, message: "OTP expired" });
        }

        if (String(record.otp) !== String(otp)) {
            return res.json({ success: false, message: "Invalid OTP" });
        }

        db.execute(
            "UPDATE otp_verification SET used = TRUE WHERE id = ?",
            [record.id]
        );

        const roleSql = `
            SELECT managerid, activeflag
            FROM emp_details
            WHERE LOWER(empmail) = LOWER(?)
            LIMIT 1
        `;

        db.execute(roleSql, [email], (err2, userResult) => {
            if (err2 || userResult.length === 0) {
                return res.json({ success: false, message: "User not found" });
            }

            const managerid = userResult[0].managerid;
            const activeflag = parseInt(userResult[0].activeflag);

            console.log("Activeflag:", activeflag);

            if (activeflag === 2) {
                return res.json({
                    success: false,
                    message: "Your account is pending manager approval. Please wait."
                });
            }

            if (activeflag === 0) {
                return res.json({
                    success: false,
                    message: "Access denied. Your account is inactive."
                });
            }

            if (activeflag === 1) {
                if (!managerid) {
                    return res.json({
                        success: true,
                        role: "manager",
                        message: "Welcome, Manager!"
                    });
                } else {
                    return res.json({
                        success: true,
                        role: "employee",
                        message: "Welcome back!"
                    });
                }
            }

            // Fallback safety
            return res.json({
                success: false,
                message: "Invalid account state"
            });
        });
    });
});

// GET EMPLOYEE PROFILE
app.get("/get-profile", (req, res) => {
    const { email } = req.query;

    if (!email) {
        return res.json({ success: false, message: "Email required" });
    }

    const sql = `
        SELECT 
            empname,
            empid,
            empmail,
            dept,
            subdept,
            position,
            location,
            managerid
        FROM emp_details
        WHERE LOWER(empmail) = LOWER(?)
        LIMIT 1
    `;

    db.query(sql, [email], (err, results) => {
        if (err) {
            console.error("PROFILE ERROR:", err);
            return res.json({ success: false });
        }

        if (results.length === 0) {
            return res.json({ success: false });
        }

        res.json({
            success: true,
            user: results[0]
        });
    });
});

// MARK LOGIN ATTENDANCE
app.post("/mark-login", (req, res) => {
    const { email } = req.body;
    const today = new Date().toISOString().split("T")[0];

    db.query(
        "SELECT empid FROM emp_details WHERE LOWER(empmail) = LOWER(?) LIMIT 1",
        [email],
        (err, empResult) => {
            if (err || empResult.length === 0) {
                return res.json({ success: false, message: "Employee not found" });
            }

            const empid = empResult[0].empid;

            const checkSql = `
                SELECT log_id FROM login_logout 
                WHERE empid = ? AND login_date = ? 
                LIMIT 1
            `;

            db.query(checkSql, [empid, today], (err2, result) => {
                if (err2) return res.json({ success: false, message: "DB error" });

                if (result.length > 0) {
                    return res.json({
                        success: false,
                        message: "Attendance already recorded for today"
                    });
                }

                const insertSql = `
                    INSERT INTO login_logout (empid, login_time, login_date)
                    VALUES (?, NOW(), ?)
                `;

                db.query(insertSql, [empid, today], (err3) => {
                    if (err3) return res.json({ success: false });
                    res.json({ success: true, message: "Login recorded" });
                });
            });
        }
    );
});

// MARK LOGOUT ATTENDANCE
app.post("/mark-logout", (req, res) => {
    const { email } = req.body;
    const today = new Date().toISOString().split("T")[0];

    db.query(
        "SELECT empid FROM emp_details WHERE LOWER(empmail) = LOWER(?) LIMIT 1",
        [email],
        (err, empResult) => {
            if (err || empResult.length === 0) return res.json({ success: false });

            const empid = empResult[0].empid;

            const checkStatusSql = `
                SELECT logout_time FROM login_logout 
                WHERE empid = ? AND login_date = ?
            `;

            db.query(checkStatusSql, [empid, today], (err2, result) => {
                if (result.length === 0) {
                    return res.json({ success: false, message: "No login record found for today" });
                }
                
                if (result[0].logout_time !== null) {
                    return res.json({ success: false, message: "Already logged out for today" });
                }

                const logoutSql = `
                    UPDATE login_logout 
                    SET logout_time = NOW() 
                    WHERE empid = ? AND login_date = ? AND logout_time IS NULL
                `;

                db.query(logoutSql, [empid, today], (err3) => {
                    if (err3) return res.json({ success: false });
                    res.json({ success: true, message: "Logout successful" });
                });
            });
        }
    );
});

// GET EMPLOYEES BY STATUS (For Manager Portal Tabs)
app.get("/get-employees-by-status", (req, res) => {
    const { status } = req.query;
    
    if (!status) {
        return res.json({ success: false, message: "Status parameter required" });
    }
    
    const sql = `
        SELECT empid, empname, empmail, dept, position, location, 
               subdept, managerid, created_at
        FROM emp_details 
        WHERE activeflag = ?
        ORDER BY empname
    `;
    
    db.query(sql, [status], (err, results) => {
        if (err) {
            console.error("GET EMPLOYEES ERROR:", err);
            return res.json({ success: false, message: "Database error" });
        }
        
        res.json({
            success: true,
            employees: results
        });
    });
});

// UPDATE EMPLOYEE STATUS (Activate/Deactivate/Approve/Reject)
app.post("/update-employee-status", (req, res) => {
    const { empid, activeflag } = req.body;
    
    if (!empid || activeflag === undefined) {
        return res.json({ success: false, message: "Missing parameters" });
    }
    
    // First get employee email for notification
    const getEmailSql = "SELECT empmail, empname FROM emp_details WHERE empid = ?";
    
    db.query(getEmailSql, [empid], (err, result) => {
        if (err || result.length === 0) {
            return res.json({ success: false, message: "Employee not found" });
        }
        
        const employeeEmail = result[0].empmail;
        const employeeName = result[0].empname;
        
        // Update status in database
        const updateSql = "UPDATE emp_details SET activeflag = ? WHERE empid = ?";
        
        db.query(updateSql, [activeflag, empid], (err2) => {
            if (err2) {
                console.error("UPDATE STATUS ERROR:", err2);
                return res.json({ success: false, message: "Update failed" });
            }
            
            // Update Excel file
            updateExcelStatus(empid, activeflag);
            
            // Send email notification
            sendStatusNotification(employeeEmail, employeeName, activeflag);
            
            res.json({ success: true, message: "Status updated successfully" });
        });
    });
});

// HELPER FUNCTION: Update Excel file with new status
function updateExcelStatus(empid, newStatus) {
    try {
        const workbook = xlsx.readFile('Book1.xlsx');
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);
        
        // Update status in data
        const updatedData = data.map(row => {
            if (row.empid == empid) {
                row.activeflag = newStatus;
            }
            return row;
        });
        
        // Write back to Excel
        const newSheet = xlsx.utils.json_to_sheet(updatedData);
        const newWorkbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(newWorkbook, newSheet, "Sheet1");
        xlsx.writeFile(newWorkbook, "Book1.xlsx");
        
        console.log(`Excel updated for empid: ${empid}, status: ${newStatus}`);
    } catch (error) {
        console.error("Excel update error:", error);
    }
}

// HELPER FUNCTION: Send status notification email
function sendStatusNotification(email, name, status) {
    let subject, html;
    
    switch(status) {
        case 0:
            subject = "Account Deactivated - Premier Energies";
            html = `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2 style="color: #2a033d;">Account Status Update</h2>
                    <p>Dear ${name},</p>
                    <p>Your employee account has been <strong style="color: #ff5252;">deactivated</strong>.</p>
                    <p>If you believe this is an error, please contact your manager.</p>
                    <hr>
                    <p>Regards,<br><strong>Premier Energies HR Team</strong></p>
                </div>
            `;
            break;
        case 1:
            subject = "Account Activated - Premier Energies";
            html = `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2 style="color: #2a033d;">Account Status Update</h2>
                    <p>Dear ${name},</p>
                    <p>Your employee account has been <strong style="color: #00c853;">activated</strong>.</p>
                    <p>You can now access the employee portal.</p>
                    <hr>
                    <p>Regards,<br><strong>Premier Energies HR Team</strong></p>
                </div>
            `;
            break;
        case 2:
            subject = "Account Approval Pending - Premier Energies";
            html = `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2 style="color: #2a033d;">Account Status Update</h2>
                    <p>Dear ${name},</p>
                    <p>Your employee account is <strong style="color: #2979ff;">pending approval</strong>.</p>
                    <p>You will be notified once approved by your manager.</p>
                    <hr>
                    <p>Regards,<br><strong>Premier Energies HR Team</strong></p>
                </div>
            `;
            break;
    }
    
    const mailOptions = {
        from: 'peddadasuryalalitha@gmail.com',
        to: email,
        subject: subject,
        html: html
    };
    
    transporter.sendMail(mailOptions)
        .then(() => console.log(`Status email sent to ${email}`))
        .catch(e => console.log("Mail Error:", e));
}

// GET MANAGER'S TEAM (Employees under this manager)
app.get("/get-manager-team", (req, res) => {
    const { managerid } = req.query;
    
    if (!managerid) {
        return res.json({ success: false, message: "Manager ID required" });
    }
    
    const sql = `
        SELECT empid, empname, empmail, dept, position, activeflag, 
               location, subdept, created_at
        FROM emp_details 
        WHERE managerid = ?
        ORDER BY activeflag DESC, empname
    `;
    
    db.query(sql, [managerid], (err, results) => {
        if (err) {
            console.error("GET TEAM ERROR:", err);
            return res.json({ success: false, message: "Database error" });
        }
        
        res.json({
            success: true,
            team: results
        });
    });
});

// GET ATTENDANCE REPORT
app.get("/get-attendance-report", (req, res) => {
    const { empid, startDate, endDate } = req.query;
    
    let sql = `
        SELECT l.log_id, l.empid, e.empname, 
               DATE(l.login_date) as date,
               TIME(l.login_time) as login_time,
               TIME(l.logout_time) as logout_time,
               TIMESTAMPDIFF(MINUTE, l.login_time, l.logout_time) as duration_minutes
        FROM login_logout l
        JOIN emp_details e ON l.empid = e.empid
        WHERE 1=1
    `;
    
    const params = [];
    
    if (empid) {
        sql += " AND l.empid = ?";
        params.push(empid);
    }
    
    if (startDate) {
        sql += " AND l.login_date >= ?";
        params.push(startDate);
    }
    
    if (endDate) {
        sql += " AND l.login_date <= ?";
        params.push(endDate);
    }
    
    sql += " ORDER BY l.login_date DESC, l.login_time DESC";
    
    db.query(sql, params, (err, results) => {
        if (err) {
            console.error("ATTENDANCE REPORT ERROR:", err);
            return res.json({ success: false, message: "Database error" });
        }
        
        res.json({
            success: true,
            attendance: results
        });
    });
});

// SERVER START
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});