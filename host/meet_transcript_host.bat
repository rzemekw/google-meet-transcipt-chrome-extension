@echo off
where py >nul 2>nul
if %errorlevel%==0 (py -3 "%~dp0meet_transcript_host.py") else (python "%~dp0meet_transcript_host.py")
