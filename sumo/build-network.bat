@echo off
setlocal
if "%SUMO_HOME%"=="" (
  echo SUMO_HOME is not set.
  echo Set it to your SUMO installation directory first.
  exit /b 1
)
"%SUMO_HOME%\bin\netconvert.exe" --node-files "%~dp0nodes.nod.xml" --edge-files "%~dp0edges.edg.xml" --output-file "%~dp0network.net.xml"
echo.
echo Built: %~dp0network.net.xml
echo Open a scenario with:
echo   "%SUMO_HOME%\bin\sumo-gui.exe" -c "%~dp0scenarios\bicycle-car.sumocfg"
endlocal
