#!/bin/bash
sudo -u postgres psql -d uyushma -x -c "SELECT * FROM otp_codes WHERE phone LIKE '%911278902%' ORDER BY created_at DESC LIMIT 3;"

