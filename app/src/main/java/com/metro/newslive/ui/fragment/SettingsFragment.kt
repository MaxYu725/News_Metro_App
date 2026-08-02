package com.metro.newslive.ui.fragment

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.SeekBar
import android.widget.TextView
import androidx.fragment.app.Fragment
import com.metro.newslive.R

class SettingsFragment : Fragment() {

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.fragment_settings, container, false)

        val seekBarFontSize = view.findViewById<SeekBar>(R.id.seekBarFontSize)
        val tvFontPreview = view.findViewById<TextView>(R.id.tvFontPreview)
        val tvWorkerStatus = view.findViewById<TextView>(R.id.tvWorkerStatus)

        tvWorkerStatus.text = "Worker API: https://metro-news-api.maxyu0725.workers.dev/ 🟢 Normal"

        seekBarFontSize?.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                val sizeSp = 14f + (progress * 0.5f)
                tvFontPreview?.textSize = sizeSp
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })

        return view
    }
}
