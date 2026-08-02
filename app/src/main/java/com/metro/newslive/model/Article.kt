package com.metro.newslive.model

data class Article(
    val id: String,
    val title: String,
    val summary: String,
    val source: String,
    val category: String,
    val pubDate: String,
    val url: String,
    var isExpanded: Boolean = false
)
