#!/bin/bash
sudo -u postgres psql -d uyushma -x -c "SELECT * FROM users WHERE phone LIKE '%911278902%';"

